import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import type { Urgency } from "@/lib/supabase/types";
import { TechEscalationsClient, type TechEscalation } from "./escalations-client";

export const metadata = { title: "Alerts" };
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
  } | null;
};

type LinkedAppt = {
  customer_id: string;
  id: string;
  confirmation_code: string;
};

export default async function TechEscalationsPage() {
  const session = await requireRole("technician");
  const sb = await createSupabaseServerClient();

  const { data: rawRows, error } = await sb
    .from("escalations")
    .select(
      "id, customer_id, summary, urgency, resolved, created_at, customers(id, phone, name)"
    )
    .eq("resolved", false)
    .order("created_at", { ascending: false });

  if (error) return <ErrorState message={error.message} />;

  const rows = ((rawRows ?? []) as unknown) as RawRow[];
  const customerIds = Array.from(new Set(rows.map((r) => r.customer_id)));

  // Find each customer's most recent appointment assigned to this tech, so the
  // card can deep-link into the job detail page they already know.
  const linkedByCustomer: Record<string, LinkedAppt | undefined> = {};
  if (customerIds.length > 0) {
    const { data: apptRows } = await sb
      .from("appointments")
      .select("id, customer_id, confirmation_code, slot_start")
      .in("customer_id", customerIds)
      .eq("assigned_technician_id", session.userId)
      .order("slot_start", { ascending: false });

    for (const a of (apptRows ?? []) as Array<LinkedAppt & { slot_start: string }>) {
      if (!linkedByCustomer[a.customer_id]) {
        linkedByCustomer[a.customer_id] = {
          customer_id: a.customer_id,
          id: a.id,
          confirmation_code: a.confirmation_code
        };
      }
    }
  }

  const escalations: TechEscalation[] = rows.map((r) => ({
    id: r.id,
    customer_id: r.customer_id,
    summary: r.summary,
    urgency: r.urgency,
    created_at: r.created_at,
    customer: r.customers,
    linked_job: linkedByCustomer[r.customer_id] ?? null
  }));

  return <TechEscalationsClient initial={escalations} technicianId={session.userId} />;
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="surface-paper min-h-dvh px-5 py-10">
      <div className="border border-destructive/40 bg-card px-5 py-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-destructive">
          Couldn&apos;t load alerts
        </p>
        <p className="mt-2 text-sm text-foreground">{message}</p>
      </div>
    </div>
  );
}
