import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { computePriceBaseline, valueOf } from "@/lib/kpi/queries";
import type { Customer, Urgency } from "@/lib/supabase/types";
import {
  CustomersClient,
  type CustomerListItem,
  type TimelineEntry
} from "./customers-client";

export const metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  const { id: selectedId } = await searchParams;

  const [{ data: customerRows, error }, baseline] = await Promise.all([
    supabase
      .from("customers")
      .select("id, phone, name, address, notes, opted_out, tags, acquisition, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    computePriceBaseline(supabase)
  ]);

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

  const customers = (customerRows ?? []) as Array<
    Pick<
      Customer,
      "id" | "phone" | "name" | "address" | "notes" | "opted_out" | "tags" | "acquisition" | "created_at"
    >
  >;

  // LTV + visit counts: one bulk fetch of completed jobs, valued with the same
  // tier-average estimation the KPI dashboard uses (price_quoted when present).
  const [{ data: apptRows }, { data: convoRows }] = await Promise.all([
    supabase
      .from("appointments")
      .select("customer_id, price_quoted, status")
      .eq("status", "completed")
      .limit(5000),
    supabase.from("conversations").select("id, customer_id").limit(1000)
  ]);

  const convoByCustomer = new Map(
    ((convoRows ?? []) as Array<{ id: string; customer_id: string }>).map((c) => [
      c.customer_id,
      c.id
    ])
  );

  const stats = new Map<string, { visits: number; ltv: number }>();
  for (const a of (apptRows ?? []) as Array<{
    customer_id: string;
    price_quoted: number | null;
  }>) {
    const entry = stats.get(a.customer_id) ?? { visits: 0, ltv: 0 };
    entry.visits += 1;
    entry.ltv += valueOf(a.price_quoted, baseline);
    stats.set(a.customer_id, entry);
  }

  const list: CustomerListItem[] = customers.map((c) => ({
    id: c.id,
    phone: c.phone,
    name: c.name,
    address: c.address,
    notes: c.notes,
    opted_out: c.opted_out,
    tags: Array.isArray(c.tags) ? c.tags : [],
    acquisition: c.acquisition,
    created_at: c.created_at,
    visits: stats.get(c.id)?.visits ?? 0,
    ltv: Math.round(stats.get(c.id)?.ltv ?? 0),
    conversation_id: convoByCustomer.get(c.id) ?? null
  }));

  // Timeline for the selected customer only — four bounded queries, merged by
  // date in memory (same approach as the escalations page's lastBookings).
  const timeline = selectedId ? await loadTimeline(supabase, selectedId) : [];

  return (
    <CustomersClient
      initial={list}
      initialSelectedId={selectedId ?? null}
      timeline={timeline}
    />
  );
}

async function loadTimeline(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  customerId: string
): Promise<TimelineEntry[]> {
  const [appts, escalations, payments, feedback] = await Promise.all([
    supabase
      .from("appointments")
      .select("confirmation_code, pest_type, slot_start, status")
      .eq("customer_id", customerId)
      .order("slot_start", { ascending: false })
      .limit(50),
    supabase
      .from("escalations")
      .select("summary, urgency, resolved, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("payments")
      .select("purpose, amount, status, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("feedback")
      .select("rating, comment, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(50)
  ]);

  const entries: TimelineEntry[] = [];

  for (const a of (appts.data ?? []) as Array<{
    confirmation_code: string;
    pest_type: string;
    slot_start: string;
    status: string;
  }>) {
    entries.push({
      kind: "booking",
      at: a.slot_start,
      label: a.pest_type,
      sub: `${a.confirmation_code} · ${a.status}`
    });
  }
  for (const e of (escalations.data ?? []) as Array<{
    summary: string;
    urgency: Urgency;
    resolved: boolean;
    created_at: string;
  }>) {
    entries.push({
      kind: "escalation",
      at: e.created_at,
      label: e.summary,
      sub: `${e.urgency}${e.resolved ? " · resolved" : " · open"}`
    });
  }
  for (const p of (payments.data ?? []) as Array<{
    purpose: string;
    amount: number;
    status: string;
    created_at: string;
  }>) {
    entries.push({
      kind: "payment",
      at: p.created_at,
      label: `₹${p.amount} · ${p.purpose === "deposit" ? "booking deposit" : "AMC renewal"}`,
      sub: p.status
    });
  }
  for (const f of (feedback.data ?? []) as Array<{
    rating: number;
    comment: string | null;
    created_at: string;
  }>) {
    entries.push({
      kind: "feedback",
      at: f.created_at,
      label: `Rated ${f.rating}/5`,
      sub: f.comment ?? null
    });
  }

  return entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
