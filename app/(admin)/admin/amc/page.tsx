import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import type { AmcStatus } from "@/lib/supabase/types";
import { AmcClient, type AmcRow, type CustomerOption } from "./amc-client";

export const metadata = { title: "AMC" };
export const dynamic = "force-dynamic";

type RawAmc = {
  customer_id: string;
  commenced_at: string;
  renews_at: string;
  lead_days: number;
  pest_type: string;
  annual_price: number | null;
  status: AmcStatus;
  reminder_sent_at: string | null;
  followup_sent_at: string | null;
  notes: string | null;
  customers: { name: string | null; phone: string } | null;
};

export default async function AmcPage() {
  await requireRole("admin");
  const sb = await createSupabaseServerClient();

  const [amcResult, customersResult] = await Promise.all([
    sb
      .from("amc")
      .select(
        "customer_id, commenced_at, renews_at, lead_days, pest_type, annual_price, status, reminder_sent_at, followup_sent_at, notes, customers(name, phone)"
      )
      .order("renews_at", { ascending: true }),
    sb.from("customers").select("id, name, phone").order("name", { ascending: true })
  ]);

  if (amcResult.error || customersResult.error) {
    return (
      <ErrorState message={amcResult.error?.message ?? customersResult.error?.message ?? ""} />
    );
  }

  const rows = ((amcResult.data ?? []) as unknown) as RawAmc[];
  const contracts: AmcRow[] = rows.map((r) => ({
    customer_id: r.customer_id,
    commenced_at: r.commenced_at,
    renews_at: r.renews_at,
    lead_days: r.lead_days,
    pest_type: r.pest_type,
    annual_price: r.annual_price,
    status: r.status,
    reminder_sent_at: r.reminder_sent_at,
    followup_sent_at: r.followup_sent_at,
    notes: r.notes,
    customer: r.customers
  }));

  const customers: CustomerOption[] = (customersResult.data ?? []).map((c) => ({
    id: c.id,
    label: (c.name?.trim() || c.phone || c.id.slice(0, 8)) + (c.name?.trim() ? ` · ${c.phone}` : ""),
    phone: c.phone,
    has_amc: contracts.some((amc) => amc.customer_id === c.id)
  }));

  return <AmcClient initial={contracts} customers={customers} />;
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="surface-paper min-h-dvh px-6 py-16 md:px-12">
      <div className="mx-auto max-w-2xl border border-destructive/40 bg-card px-6 py-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-destructive">
          Database error
        </p>
        <p className="mt-2 text-sm text-foreground">{message}</p>
      </div>
    </div>
  );
}
