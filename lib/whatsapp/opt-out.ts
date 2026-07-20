import { supabase } from "@/lib/supabase/client";

// DPDP Act / Do-Not-Disturb opt-out handling for inbound WhatsApp.
//
// We match only unambiguous keywords on an exact (whole-message) basis so we
// never mistake "stop by tomorrow" or "cancel my appointment" for an opt-out.
// Note CANCEL/END/QUIT are deliberately excluded — they collide with booking
// intents and are handled by the agent instead.

const OPT_OUT_WORDS = new Set([
  "stop",
  "stop all",
  "unsubscribe",
  "unsub",
  "optout",
  "opt out",
  "opt-out"
]);

const OPT_IN_WORDS = new Set([
  "start",
  "unstop",
  "resume",
  "subscribe",
  "optin",
  "opt in",
  "opt-in"
]);

export type OptIntent = "opt_out" | "opt_in";

export function detectOptIntent(text: string): OptIntent | null {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, "");
  if (OPT_OUT_WORDS.has(t)) return "opt_out";
  if (OPT_IN_WORDS.has(t)) return "opt_in";
  return null;
}

export const OPT_OUT_REPLY =
  "You're unsubscribed — we won't send you any more check-in or follow-up messages. " +
  "You'll still get reminders for visits you've booked, and you can message us anytime. Reply START to resume.";

export const OPT_IN_REPLY =
  "You're resubscribed — welcome back. Reply STOP anytime to unsubscribe again.";

// Persist the opt-out state on the customer record.
export async function applyOptIntent(customerId: string, intent: OptIntent): Promise<void> {
  const db = supabase();
  await db
    .from("customers")
    .update(
      intent === "opt_out"
        ? { opted_out: true, opted_out_at: new Date().toISOString() }
        : { opted_out: false, opted_out_at: null }
    )
    .eq("id", customerId);
}
