import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { sendTemplateToCustomer } from "@/lib/whatsapp/outbound";
import {
  TEMPLATES,
  TEMPLATE_LANG,
  bodyWithQuickReplies,
  textBody,
  firstName
} from "@/lib/whatsapp/templates";
import { requireCronAuth } from "@/lib/cron-auth";
import { BUSINESS_TZ } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const db = supabase();
  const now = new Date();
  const in23h = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  // The window is wider than the hourly cadence (so a missed run doesn't skip
  // anyone); reminder_sent_at is what guarantees exactly one send per booking.
  const upcoming = await db
    .from("appointments")
    .select("id, confirmation_code, slot_start, customers(phone, name, opted_out)")
    .eq("status", "booked")
    .is("reminder_sent_at", null)
    .gte("slot_start", in23h.toISOString())
    .lt("slot_start", in25h.toISOString());

  if (upcoming.error) return NextResponse.json({ error: upcoming.error.message }, { status: 500 });

  let sent = 0;
  for (const appt of upcoming.data ?? []) {
    const customer = appt.customers as unknown as {
      phone: string;
      name: string | null;
      opted_out: boolean | null;
    };
    if (!customer?.phone) continue;
    const when = new Date(appt.slot_start).toLocaleString("en-US", {
      timeZone: BUSINESS_TZ,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
    try {
      // Fires ~24h ahead, so almost always outside the 24h window → template.
      // Transactional: customer booked, they expect this; opt-out doesn't apply.
      // Preferred: the quick-reply variant ([Confirm][Reschedule][Cancel] — a
      // tap opens the service window and routes via rem:* payloads in the
      // webhook). Falls back to the plain text template until the buttons
      // template is approved/configured.
      const bodyParams = [firstName(customer.name), when, appt.confirmation_code];
      const gate = TEMPLATES.reminderButtons
        ? await sendTemplateToCustomer(
            customer,
            TEMPLATES.reminderButtons,
            TEMPLATE_LANG,
            bodyWithQuickReplies(bodyParams, [
              `rem:confirm:${appt.id}`,
              `rem:resched:${appt.id}`,
              `rem:cancel:${appt.id}`
            ]),
            { kind: "transactional" }
          )
        : await sendTemplateToCustomer(
            customer,
            TEMPLATES.reminder,
            TEMPLATE_LANG,
            textBody(...bodyParams),
            { kind: "transactional" }
          );
      if (gate.ok) {
        sent++;
        const upd = await db
          .from("appointments")
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq("id", appt.id);
        if (upd.error) console.error("[reminders] mark failed", appt.id, upd.error.message);
      }
    } catch (err) {
      console.error("[reminders] send failed", err);
    }
  }

  return NextResponse.json({ checked: upcoming.data?.length ?? 0, sent });
}
