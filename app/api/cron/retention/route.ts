import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

// DPDP Act retention: delete WhatsApp chat logs that have been idle for longer
// than the retention window. We only drop the `conversations` row (the chat
// history in state_json) — appointments, escalations, and the customer record
// stay, so business history is untouched. If the customer messages again later,
// a fresh conversation is created automatically.
//
// Window is configurable but defaults to 6 months (the agreed policy).
const RETENTION_CONV_MONTHS = Number(process.env.RETENTION_CONV_MONTHS ?? 6);

// Webhook-dedup rows only need to outlive Meta's redelivery horizon.
const WA_MESSAGES_RETENTION_DAYS = 7;

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const db = supabase();

  // Prune webhook idempotency rows regardless of the chat-log policy.
  const dedupCutoff = new Date(Date.now() - WA_MESSAGES_RETENTION_DAYS * 86_400_000);
  const dedup = await db
    .from("wa_messages")
    .delete({ count: "exact" })
    .lt("received_at", dedupCutoff.toISOString());
  if (dedup.error) console.error("[retention] wa_messages prune failed", dedup.error.message);

  if (!Number.isFinite(RETENTION_CONV_MONTHS) || RETENTION_CONV_MONTHS <= 0) {
    return NextResponse.json({ skipped: "retention disabled", months: RETENTION_CONV_MONTHS });
  }

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RETENTION_CONV_MONTHS);

  const { error, count } = await db
    .from("conversations")
    .delete({ count: "exact" })
    .lt("last_message_at", cutoff.toISOString());

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // SLA event log rows age out on the same clock. (Deleting a conversation
  // already cascades its events; this catches events for still-active threads.)
  const events = await db
    .from("message_events")
    .delete({ count: "exact" })
    .lt("at", cutoff.toISOString());
  if (events.error) console.error("[retention] message_events prune failed", events.error.message);

  return NextResponse.json({
    purged: count ?? 0,
    purgedEvents: events.count ?? 0,
    cutoff: cutoff.toISOString(),
    months: RETENTION_CONV_MONTHS
  });
}
