import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase/client";
import { sendWhatsAppToCustomer } from "@/lib/whatsapp/outbound";
import { detectAbandonedBooking, detectAbandonedFlowBooking } from "@/lib/recovery";
import { flowEngine } from "@/lib/flows/definitions";
import { parseFlowState } from "@/lib/flows/engine";
import { deliverSends } from "@/lib/flows/deliver";
import { assistantTurnsFor } from "@/lib/flows/transcript";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

// Re-engagement nudge: one short message ~30+ min after the assistant's last reply
// if the customer hasn't responded. Sent only once per silence window; cleared the
// moment the customer messages back (see saveConversationHistory).

const IDLE_MIN_MINUTES = 30;       // don't nudge until at least this much silence
const IDLE_MAX_HOURS = 23;         // stay safely inside WhatsApp's 24h service window
const BATCH_LIMIT = 50;

const NUDGE_TEXT =
  "Just checking back — I'm still here whenever you're ready to pick this up. No rush.";

type ConversationRow = {
  id: string;
  customer_id: string;
  state_json: unknown;
  flow_state: unknown;
  agent_paused: boolean;
  customers: { phone: string | null; opted_out: boolean | null; name: string | null } | null;
};

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const db = supabase();
  const now = new Date();
  const idleSince = new Date(now.getTime() - IDLE_MIN_MINUTES * 60_000);
  const oldestEligible = new Date(now.getTime() - IDLE_MAX_HOURS * 60 * 60_000);

  const candidates = await db
    .from("conversations")
    .select("id, customer_id, state_json, flow_state, agent_paused, customers(phone, opted_out, name)")
    .lt("last_message_at", idleSince.toISOString())
    .gt("last_message_at", oldestEligible.toISOString())
    .is("nudged_at", null)
    .limit(BATCH_LIMIT);

  if (candidates.error) {
    return NextResponse.json({ error: candidates.error.message }, { status: 500 });
  }

  let sent = 0;
  let skipped = 0;

  // Supabase types embedded relations as arrays; the unique constraint on
  // conversations.customer_id guarantees a single customer per row at runtime.
  for (const row of (candidates.data ?? []) as unknown as ConversationRow[]) {
    const customer = row.customers;
    // Human-held threads (agent_paused) belong to staff — no automated outreach.
    if (!customer?.phone || row.agent_paused) {
      skipped++;
      continue;
    }

    const history = Array.isArray(row.state_json) ? (row.state_json as Anthropic.Messages.MessageParam[]) : [];
    const last = history[history.length - 1];
    // Only nudge when the assistant spoke last — i.e. we're genuinely waiting on the customer.
    if (!last || last.role !== "assistant") {
      skipped++;
      continue;
    }

    // Booking-intent threads (either signal era) are owned by the
    // abandoned-booking recovery cron — never double-message.
    if (detectAbandonedFlowBooking(row.flow_state) ?? detectAbandonedBooking(history)) {
      skipped++;
      continue;
    }

    // Eligibility is capped at IDLE_MAX_HOURS (23h), so every nudge is inside
    // Meta's 24h service window by construction — a free-form service message
    // works and costs nothing, unlike a paid marketing template.
    const gate = await sendWhatsAppToCustomer(
      { phone: customer.phone, opted_out: customer.opted_out },
      NUDGE_TEXT,
      { kind: "promotional" }
    ).catch((err) => {
      console.error("[nudges] whatsapp send failed", err);
      return { ok: false as const, reason: "no_phone" as const };
    });

    if (!gate.ok) {
      skipped++;
      continue;
    }

    // MCQ era: when the customer is parked mid-flow (menu, manage, …),
    // re-present the exact question after the nudge so one tap resumes.
    const flowState = parseFlowState(row.flow_state);
    let mcqTurns: Anthropic.Messages.MessageParam[] = [];
    if (flowState && customer.phone) {
      try {
        const represented = await flowEngine().represent(
          { customerPhone: customer.phone, customerId: row.customer_id },
          flowState
        );
        await deliverSends(customer.phone, represented.sends);
        mcqTurns = assistantTurnsFor(represented.sends);
      } catch (err) {
        console.error("[nudges] MCQ re-present failed", err);
      }
    }

    const updatedHistory: Anthropic.Messages.MessageParam[] = [
      ...history,
      { role: "assistant", content: [{ type: "text", text: NUDGE_TEXT }] },
      ...mcqTurns
    ];

    const upd = await db
      .from("conversations")
      .update({ nudged_at: now.toISOString(), state_json: updatedHistory })
      .eq("id", row.id);

    if (upd.error) {
      console.error("[nudges] mark failed", row.id, upd.error.message);
      continue;
    }
    sent++;
  }

  return NextResponse.json({
    checked: candidates.data?.length ?? 0,
    sent,
    skipped
  });
}
