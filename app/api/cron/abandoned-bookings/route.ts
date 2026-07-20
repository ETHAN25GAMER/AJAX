import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase/client";
import { sendWhatsAppToCustomer } from "@/lib/whatsapp/outbound";
import { firstName } from "@/lib/whatsapp/templates";
import { detectAbandonedBooking, detectAbandonedFlowBooking } from "@/lib/recovery";
import { flowEngine } from "@/lib/flows/definitions";
import { parseFlowState } from "@/lib/flows/engine";
import { deliverSends } from "@/lib/flows/deliver";
import { assistantTurnsFor } from "@/lib/flows/transcript";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

// Abandoned-booking recovery: the customer got a quote or saw availability but
// never confirmed a booking. One personalized message per silence window,
// referencing what they were actually looking at — higher-converting than the
// generic nudge, which skips these threads entirely (see nudges/route.ts).

const IDLE_MIN_MINUTES = 45;       // give them time to come back on their own
const IDLE_MAX_HOURS = 23;         // stay safely inside WhatsApp's 24h service window
const BATCH_LIMIT = 50;

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
    .is("recovery_sent_at", null)
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
    if (!customer?.phone || row.agent_paused) {
      skipped++;
      continue;
    }

    const history = Array.isArray(row.state_json)
      ? (row.state_json as Anthropic.Messages.MessageParam[])
      : [];
    const last = history[history.length - 1];
    // Only reach out when the assistant spoke last — we're waiting on the customer.
    if (!last || last.role !== "assistant") {
      skipped++;
      continue;
    }

    // Two signals: legacy agent transcripts (tool_results) and the MCQ era's
    // flow_state (booking flow, past the pest step).
    const flowState = parseFlowState(row.flow_state);
    const abandoned =
      detectAbandonedFlowBooking(row.flow_state) ?? detectAbandonedBooking(history);
    if (!abandoned) {
      skipped++;
      continue;
    }

    const text = recoveryText(firstName(customer.name), abandoned.pestType, abandoned.priceLabel);

    // Eligibility is capped at IDLE_MAX_HOURS (23h), so every send is inside
    // Meta's 24h service window by construction. Promotional: opted-out
    // customers are skipped by the gate.
    const gate = await sendWhatsAppToCustomer(
      { phone: customer.phone, opted_out: customer.opted_out },
      text,
      { kind: "promotional" }
    ).catch((err) => {
      console.error("[abandoned-bookings] whatsapp send failed", err);
      return { ok: false as const, reason: "no_phone" as const };
    });

    if (!gate.ok) {
      skipped++;
      continue;
    }

    // MCQ era: after the recovery line, put the exact question they left back
    // on their screen so one tap resumes the booking.
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
        console.error("[abandoned-bookings] MCQ re-present failed", err);
      }
    }

    const updatedHistory: Anthropic.Messages.MessageParam[] = [
      ...history,
      { role: "assistant", content: [{ type: "text", text }] },
      ...mcqTurns
    ];

    const upd = await db
      .from("conversations")
      .update({ recovery_sent_at: now.toISOString(), state_json: updatedHistory })
      .eq("id", row.id);

    if (upd.error) {
      console.error("[abandoned-bookings] mark failed", row.id, upd.error.message);
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

function recoveryText(name: string, pestType: string | null, priceLabel: string | null): string {
  const service = pestType ? `${pestType} treatment` : "a treatment";
  const price = priceLabel ? ` (around ${priceLabel})` : "";
  return (
    `Hi ${name} — you were looking at ${service}${price} earlier. ` +
    `Want me to check available slots and hold one for you? Just reply here and we'll pick a time.`
  );
}
