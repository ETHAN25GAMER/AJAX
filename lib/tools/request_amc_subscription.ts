import { getOrCreateCustomer, supabase } from "@/lib/supabase/client";

type Args = {
  customer_phone: string;
  pest_type: string;
  notes?: string;
};

// Customer (without an existing AMC) said they want to subscribe. Stage as an
// escalation so admin can quote the annual price, collect payment, and create
// the amc row themselves.
export async function requestAmcSubscription(args: Args) {
  const db = supabase();
  const customer = await getOrCreateCustomer(args.customer_phone);

  // If they already have one, the agent should have routed to renewal — guard
  // anyway so we don't create a duplicate escalation.
  const existing = await db
    .from("amc")
    .select("status")
    .eq("customer_id", customer.id)
    .maybeSingle();
  if (existing.error) return { error: existing.error.message };
  if (existing.data && existing.data.status === "active") {
    return {
      error: "amc_already_active",
      hint: "Customer already has an active AMC. Use request_amc_renewal if they're asking about it."
    };
  }

  const trail = args.notes?.trim() ? ` — note: ${args.notes.trim()}` : "";
  const summary = `New AMC subscription interest. Pest: ${args.pest_type}.${trail}`;

  const row = await db
    .from("escalations")
    .insert({ customer_id: customer.id, summary, urgency: "normal" })
    .select("id")
    .single();
  if (row.error) return { error: row.error.message };

  return {
    escalation_id: row.data.id,
    response_window: "within 1 business day"
  };
}
