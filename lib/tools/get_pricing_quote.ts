import { supabase } from "@/lib/supabase/client";
import type { ServiceTier } from "@/lib/supabase/types";

type Args = {
  pest_type: string;
  property_size?: "small" | "medium" | "large" | "unknown";
  service_tier: ServiceTier;
};

const SIZE_SQFT = { small: 1000, medium: 2200, large: 4000, unknown: 2000 } as const;

export async function getPricingQuote(args: Args) {
  const db = supabase();
  const normalized = args.pest_type.toLowerCase().trim();
  const row = await db
    .from("pricing")
    .select("*")
    .ilike("pest_type", normalized)
    .eq("service_tier", args.service_tier)
    .maybeSingle();

  if (row.error) return { error: row.error.message };
  if (!row.data) {
    return {
      firm: false,
      requires_inspection: true,
      message: `We don't have a stored price for ${args.pest_type} at the ${args.service_tier} tier. A technician will quote on-site.`
    };
  }

  if (row.data.requires_inspection) {
    return {
      firm: false,
      requires_inspection: true,
      tier: args.service_tier,
      pest_type: row.data.pest_type,
      notes: row.data.notes
    };
  }

  const sqft = SIZE_SQFT[args.property_size ?? "unknown"];
  const point = Number(row.data.base_price) + Number(row.data.per_sqft) * sqft;
  const low = Math.round(point * 0.9);
  const high = Math.round(point * 1.15);

  return {
    firm: false,
    requires_inspection: false,
    tier: args.service_tier,
    pest_type: row.data.pest_type,
    price_low: low,
    price_high: high,
    currency: "USD",
    assumption: `assumes ${args.property_size ?? "average"} property (~${sqft} sqft)`,
    notes: row.data.notes
  };
}
