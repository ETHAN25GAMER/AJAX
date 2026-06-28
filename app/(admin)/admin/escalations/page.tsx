import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import type { Urgency } from "@/lib/supabase/types";
import { EscalationsClient, type EscalationWithCustomer } from "./escalations-client";

export const metadata = { title: "Escalations" };
export const dynamic = "force-dynamic";

type RawRow = {
  id: string;
  customer_id: string;
  summary: string;
  urgency: Urgency;
  resolved: boolean;
  created_at: string;
  customers: {
    id: string;
    phone: string;
    name: string | null;
    address: string | null;
  } | null;
};

type AppointmentSummary = {
  customer_id: string;
  confirmation_code: string;
  pest_type: string;
  slot_start: string;
  status: string;
};

export default async function EscalationsPage() {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();

  const { data: rawRows, error } = await supabase
    .from("escalations")
    .select(
      "id, customer_id, summary, urgency, resolved, created_at, customers(id, phone, name, address)"
    )
    .eq("resolved", false)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <ErrorState message={error.message} />
    );
  }

  // customer_id is a non-null FK to a single customer row at runtime; Supabase
  // still types embedded relations as arrays, so cast through unknown.
  const rows = ((rawRows ?? []) as unknown) as RawRow[];
  const customerIds = Array.from(new Set(rows.map((r) => r.customer_id)));

  // Pull each customer's most-recent booking for triage context. One extra
  // round-trip; tolerable for an inbox that's typically <50 rows.
  let lastBookings: Record<string, AppointmentSummary | undefined> = {};
  if (customerIds.length > 0) {
    const { data: apptRows } = await supabase
      .from("appointments")
      .select("customer_id, confirmation_code, pest_type, slot_start, status")
      .in("customer_id", customerIds)
      .order("slot_start", { ascending: false });

    for (const appt of (apptRows ?? []) as AppointmentSummary[]) {
      if (!lastBookings[appt.customer_id]) {
        lastBookings[appt.customer_id] = appt;
      }
    }
  }

  const escalations: EscalationWithCustomer[] = rows.map((r) => ({
    id: r.id,
    customer_id: r.customer_id,
    summary: r.summary,
    urgency: r.urgency,
    resolved: r.resolved,
    created_at: r.created_at,
    customer: r.customers,
    last_booking: lastBookings[r.customer_id] ?? null
  }));

  return <EscalationsClient initial={escalations} />;
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
