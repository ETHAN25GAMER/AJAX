import { supabase } from "@/lib/supabase/client";
import type { AmcStatus } from "@/lib/supabase/types";

type Args = { customer_phone: string };

export async function lookupAmcStatus(args: Args) {
  const db = supabase();
  const customer = await db
    .from("customers")
    .select("id, name")
    .eq("phone", args.customer_phone)
    .maybeSingle();
  if (customer.error) return { error: customer.error.message };
  if (!customer.data) return { found: false, has_amc: false };

  const amc = await db
    .from("amc")
    .select("commenced_at, renews_at, lead_days, pest_type, annual_price, status")
    .eq("customer_id", customer.data.id)
    .maybeSingle();
  if (amc.error) return { error: amc.error.message };

  if (!amc.data) {
    return { found: true, has_amc: false, customer_name: customer.data.name };
  }

  return {
    found: true,
    has_amc: true,
    customer_name: customer.data.name,
    status: amc.data.status as AmcStatus,
    pest_type: amc.data.pest_type,
    annual_price: amc.data.annual_price,
    commenced_at: amc.data.commenced_at,
    renews_at: amc.data.renews_at,
    lead_days: amc.data.lead_days
  };
}
