import { getOrCreateCustomer, supabase } from "@/lib/supabase/client";
import { sendWhatsAppTemplate } from "@/lib/whatsapp/outbound";
import { TEMPLATES, TEMPLATE_LANG, textBody } from "@/lib/whatsapp/templates";
import type { Urgency } from "@/lib/supabase/types";

type Args = {
  customer_phone: string;
  summary: string;
  urgency: Urgency;
};

const RESPONSE_WINDOW: Record<Urgency, string> = {
  low: "within 1 business day",
  normal: "within 2 hours during business hours",
  high: "as soon as possible — usually within 15 minutes"
};

export async function escalateToHuman(args: Args) {
  const db = supabase();
  const customer = await getOrCreateCustomer(args.customer_phone);

  const row = await db
    .from("escalations")
    .insert({ customer_id: customer.id, summary: args.summary, urgency: args.urgency })
    .select("id")
    .single();
  if (row.error) return { error: row.error.message };

  const technician = process.env.TECHNICIAN_ESCALATION_PHONE;
  if (technician) {
    // The technician usually isn't inside a 24h window with the business number,
    // so this internal alert goes via an approved template. Body params:
    // 1=urgency, 2=customer phone, 3=summary.
    try {
      await sendWhatsAppTemplate(
        technician,
        TEMPLATES.escalation,
        TEMPLATE_LANG,
        textBody(args.urgency.toUpperCase(), args.customer_phone, args.summary)
      );
    } catch (err) {
      // Note but don't fail the tool — escalation row is persisted either way.
      return {
        escalation_id: row.data.id,
        response_window: RESPONSE_WINDOW[args.urgency],
        whatsapp_delivery_error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  return {
    escalation_id: row.data.id,
    response_window: RESPONSE_WINDOW[args.urgency]
  };
}
