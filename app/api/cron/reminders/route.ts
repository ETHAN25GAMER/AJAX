import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { sendTemplateToCustomer } from "@/lib/whatsapp/outbound";
import { TEMPLATES, TEMPLATE_LANG, textBody, firstName } from "@/lib/whatsapp/templates";
import { BUSINESS_TZ } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (expected && auth !== expected) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const db = supabase();
  const now = new Date();
  const in23h = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const upcoming = await db
    .from("appointments")
    .select("id, confirmation_code, slot_start, customers(phone, name, opted_out)")
    .eq("status", "booked")
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
      const gate = await sendTemplateToCustomer(
        customer,
        TEMPLATES.reminder,
        TEMPLATE_LANG,
        textBody(firstName(customer.name), when, appt.confirmation_code),
        { kind: "transactional" }
      );
      if (gate.ok) sent++;
    } catch (err) {
      console.error("[reminders] send failed", err);
    }
  }

  return NextResponse.json({ checked: upcoming.data?.length ?? 0, sent });
}
