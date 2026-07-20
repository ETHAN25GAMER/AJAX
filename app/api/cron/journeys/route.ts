import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { sendTemplateToCustomer } from "@/lib/whatsapp/outbound";
import { TEMPLATE_LANG, firstName, textBody } from "@/lib/whatsapp/templates";
import { requireCronAuth } from "@/lib/cron-auth";
import type { JourneyStep, JourneyTrigger } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Journey engine: two passes per run, both idempotent.
//   1. ENROLL — for each enabled journey, trigger events newer than the
//      journey's enabled_at watermark that aren't enrolled yet. The composite
//      PK (journey, customer, trigger_ref) makes re-runs no-ops (23505).
//   2. ADVANCE — due active enrollments send their current step's template and
//      schedule the next one (or finish). Send failures keep next_run_at so
//      the next pass retries; opted-out customers cancel out of the journey.

const ENROLL_SCAN_LIMIT = 500;
const ADVANCE_BATCH_LIMIT = 50;

type JourneyRow = {
  id: string;
  trigger: JourneyTrigger;
  enabled_at: string | null;
};

type EnrollmentRow = {
  journey_id: string;
  customer_id: string;
  trigger_ref: string;
  current_position: number;
  customers: { phone: string | null; name: string | null; opted_out: boolean | null } | null;
};

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const db = supabase();
  const now = new Date();

  const journeys = await db
    .from("journeys")
    .select("id, trigger, enabled_at")
    .eq("enabled", true);
  if (journeys.error) {
    return NextResponse.json({ error: journeys.error.message }, { status: 500 });
  }

  const journeyRows = (journeys.data ?? []) as JourneyRow[];

  // Steps for all enabled journeys in one fetch.
  const stepsByJourney = new Map<string, JourneyStep[]>();
  if (journeyRows.length > 0) {
    const steps = await db
      .from("journey_steps")
      .select("journey_id, position, delay_days, template_name, template_params")
      .in(
        "journey_id",
        journeyRows.map((j) => j.id)
      )
      .order("position", { ascending: true });
    if (steps.error) return NextResponse.json({ error: steps.error.message }, { status: 500 });
    for (const s of (steps.data ?? []) as JourneyStep[]) {
      const list = stepsByJourney.get(s.journey_id) ?? [];
      list.push(s);
      stepsByJourney.set(s.journey_id, list);
    }
  }

  let enrolled = 0;
  for (const j of journeyRows) {
    enrolled += await enrollPass(db, j, stepsByJourney.get(j.id) ?? [], now);
  }

  const advance = await advancePass(db, stepsByJourney, now);

  return NextResponse.json({ journeys: journeyRows.length, enrolled, ...advance });
}

async function enrollPass(
  db: ReturnType<typeof supabase>,
  journey: JourneyRow,
  steps: JourneyStep[],
  now: Date
): Promise<number> {
  if (steps.length === 0) return 0; // step-less journey — nothing to schedule
  const watermark = journey.enabled_at ?? now.toISOString();

  // Candidate (customer, trigger_ref) pairs since the watermark.
  let candidates: Array<{ customer_id: string; trigger_ref: string }> = [];
  if (journey.trigger === "job_completed") {
    const rows = await db
      .from("appointments")
      .select("id, customer_id, completed_at")
      .eq("status", "completed")
      .gte("completed_at", watermark)
      .limit(ENROLL_SCAN_LIMIT);
    if (rows.error) {
      console.error("[journeys] enroll scan failed", journey.id, rows.error.message);
      return 0;
    }
    candidates = (rows.data ?? []).map((r) => ({
      customer_id: r.customer_id as string,
      trigger_ref: r.id as string
    }));
  } else {
    const rows = await db
      .from("customers")
      .select("id, created_at")
      .gte("created_at", watermark)
      .limit(ENROLL_SCAN_LIMIT);
    if (rows.error) {
      console.error("[journeys] enroll scan failed", journey.id, rows.error.message);
      return 0;
    }
    candidates = (rows.data ?? []).map((r) => ({
      customer_id: r.id as string,
      trigger_ref: r.id as string
    }));
  }

  if (candidates.length === 0) return 0;
  const firstRunAt = new Date(now.getTime() + steps[0].delay_days * 86_400_000).toISOString();

  let enrolled = 0;
  for (const c of candidates) {
    const ins = await db.from("journey_enrollments").insert({
      journey_id: journey.id,
      customer_id: c.customer_id,
      trigger_ref: c.trigger_ref,
      current_position: 1,
      next_run_at: firstRunAt
    });
    if (!ins.error) enrolled++;
    else if (ins.error.code !== "23505") {
      // 23505 = already enrolled (expected on re-runs); anything else is real.
      console.error("[journeys] enroll insert failed", journey.id, ins.error.message);
    }
  }
  return enrolled;
}

async function advancePass(
  db: ReturnType<typeof supabase>,
  stepsByJourney: Map<string, JourneyStep[]>,
  now: Date
): Promise<{ sent: number; finished: number; cancelled: number; failed: number }> {
  const due = await db
    .from("journey_enrollments")
    .select(
      "journey_id, customer_id, trigger_ref, current_position, customers(phone, name, opted_out)"
    )
    .eq("status", "active")
    .lte("next_run_at", now.toISOString())
    .limit(ADVANCE_BATCH_LIMIT);
  if (due.error) {
    console.error("[journeys] advance fetch failed", due.error.message);
    return { sent: 0, finished: 0, cancelled: 0, failed: 0 };
  }

  let sent = 0;
  let finished = 0;
  let cancelled = 0;
  let failed = 0;

  // Supabase types embedded relations as arrays; customer_id FKs one customer.
  for (const row of (due.data ?? []) as unknown as EnrollmentRow[]) {
    const steps = stepsByJourney.get(row.journey_id) ?? [];
    const step = steps.find((s) => s.position === row.current_position);
    const customer = row.customers;

    const update = (fields: Record<string, unknown>) =>
      db
        .from("journey_enrollments")
        .update(fields)
        .eq("journey_id", row.journey_id)
        .eq("customer_id", row.customer_id)
        .eq("trigger_ref", row.trigger_ref);

    // Step deleted since enrollment, or journey emptied → nothing left to send.
    if (!step || !customer?.phone) {
      await update({ status: "done" });
      finished++;
      continue;
    }

    const params = (Array.isArray(step.template_params) ? step.template_params : []).map((p) =>
      String(p).replaceAll("{name}", firstName(customer.name))
    );

    try {
      const gate = await sendTemplateToCustomer(
        { phone: customer.phone, opted_out: customer.opted_out },
        step.template_name,
        TEMPLATE_LANG,
        textBody(...params),
        { kind: "promotional" }
      );
      if (!gate.ok) {
        // Opted out mid-journey: stop the whole sequence, not just this step.
        await update({ status: "cancelled" });
        cancelled++;
        continue;
      }
    } catch (err) {
      // Leave next_run_at as-is — the next pass retries this step.
      console.error("[journeys] step send failed", row.journey_id, customer.phone, err);
      failed++;
      continue;
    }
    sent++;

    const next = steps.find((s) => s.position === row.current_position + 1);
    if (!next) {
      await update({ status: "done" });
      finished++;
    } else {
      await update({
        current_position: next.position,
        next_run_at: new Date(now.getTime() + next.delay_days * 86_400_000).toISOString()
      });
    }
  }

  return { sent, finished, cancelled, failed };
}
