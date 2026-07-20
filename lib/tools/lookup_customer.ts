import { supabase } from "@/lib/supabase/client";

type Args = { customer_phone: string };

export async function lookupCustomer(args: Args) {
  const db = supabase();
  const customer = await db
    .from("customers")
    .select("id, name, address, notes")
    .eq("phone", args.customer_phone)
    .maybeSingle();
  if (customer.error) return { error: customer.error.message };
  if (!customer.data) return { found: false };

  const appts = await db
    .from("appointments")
    .select("confirmation_code, pest_type, slot_start, status")
    .eq("customer_id", customer.data.id)
    .order("slot_start", { ascending: false })
    .limit(5);

  return {
    found: true,
    name: customer.data.name,
    address: customer.data.address,
    notes: customer.data.notes,
    recent_appointments: appts.data ?? []
  };
}
