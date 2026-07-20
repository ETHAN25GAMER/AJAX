import { getOrCreateCustomer, supabase } from "@/lib/supabase/client";
import { createRecordedPaymentLink } from "@/lib/payments/links";

type Args = {
  customer_phone: string;
  notes?: string;
};

// Customer confirmed they want to renew. Stage as an escalation so admin can
// process payment + push the renewal date forward — the agent does NOT auto-
// renew the contract (payment is admin's responsibility).
export async function requestAmcRenewal(args: Args) {
  const db = supabase();
  const customer = await getOrCreateCustomer(args.customer_phone);

  // Sanity check: must have an existing AMC to renew.
  const amc = await db
    .from("amc")
    .select("status, pest_type, renews_at, annual_price")
    .eq("customer_id", customer.id)
    .maybeSingle();
  if (amc.error) return { error: amc.error.message };
  if (!amc.data) {
    return {
      error: "no_amc_on_file",
      hint: "Use request_amc_subscription instead — this customer doesn't have an existing contract."
    };
  }

  const trail = args.notes?.trim() ? ` — note: ${args.notes.trim()}` : "";
  const summary =
    `AMC renewal confirmed by customer. ` +
    `Plan: ${amc.data.pest_type} (renews ${amc.data.renews_at}, ` +
    `$${amc.data.annual_price ?? "?"}/yr).${trail}`;

  const row = await db
    .from("escalations")
    .insert({ customer_id: customer.id, summary, urgency: "normal" })
    .select("id")
    .single();
  if (row.error) return { error: row.error.message };

  // Mark the AMC pending so the cron stops re-sending reminders while admin
  // finishes the renewal.
  await db
    .from("amc")
    .update({ status: "pending_renewal" })
    .eq("customer_id", customer.id);

  // When the contract has a price and Razorpay is configured, hand the agent a
  // payment link so the customer can pay right in the thread — admin still
  // finalizes the renewal (the paid webhook files a follow-up escalation).
  const price = amc.data.annual_price;
  const paymentLink =
    price && price > 0
      ? await createRecordedPaymentLink({
          customerId: customer.id,
          customerName: customer.name,
          customerPhone: args.customer_phone,
          purpose: "amc_renewal",
          amount: price,
          description: `AMC renewal — ${amc.data.pest_type}`
        })
      : null;

  return {
    escalation_id: row.data.id,
    response_window: "within 1 business day",
    ...(paymentLink
      ? {
          payment_link: paymentLink.url,
          payment_amount_inr: paymentLink.amount,
          payment_note:
            "Share this secure link so the customer can pay the renewal now. Our team still confirms the renewal after payment."
        }
      : {})
  };
}
