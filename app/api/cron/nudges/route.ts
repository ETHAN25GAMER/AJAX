import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase/client";
import { sendTemplateToCustomer } from "@/lib/whatsapp/outbound";
import { TEMPLATES, TEMPLATE_LANG, textBody, firstName } from "@/lib/whatsapp/templates";

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
  state_json: unknown;
  customers: { phone: string | null; opted_out: boolean | null; name: string | null } | null;
};

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (expected && auth !== expected) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const db = supabase();
  const now = new Date();
  const idleSince = new Date(now.getTime() - IDLE_MIN_MINUTES * 60_000);
  const oldestEligible = new Date(now.getTime() - IDLE_MAX_HOURS * 60 * 60_000);

  const candidates = await db
    .from("conversations")
    .select("id, state_json, customers(phone, opted_out, name)")
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
    if (!customer?.phone) {
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

    const gate = await sendTemplateToCustomer(
      { phone: customer.phone, opted_out: customer.opted_out },
      TEMPLATES.nudge,
      TEMPLATE_LANG,
      textBody(firstName(customer.name)),
      { kind: "promotional" }
    ).catch((err) => {
      console.error("[nudges] whatsapp send failed", customer.phone, err);
      return { ok: false as const, reason: "no_phone" as const };
    });

    if (!gate.ok) {
      skipped++;
      continue;
    }

    const updatedHistory: Anthropic.Messages.MessageParam[] = [
      ...history,
      { role: "assistant", content: [{ type: "text", text: NUDGE_TEXT }] }
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
