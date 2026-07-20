import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import type { PricingRow } from "@/lib/supabase/types";
import { PricingClient } from "./pricing-client";

export const metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("pricing")
    .select("id, pest_type, base_price, per_sqft, notes, requires_inspection")
    .order("pest_type", { ascending: true });

  if (error) {
    return (
      <div className="surface-paper min-h-dvh px-6 py-16 md:px-12">
        <div className="mx-auto max-w-2xl border border-destructive/40 bg-card px-6 py-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-destructive">
            Database error
          </p>
          <p className="mt-2 text-sm text-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  return <PricingClient initial={(data ?? []) as PricingRow[]} />;
}
