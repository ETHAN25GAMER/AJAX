import { addDays, startOfDay } from "date-fns";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import type { AppointmentStatus } from "@/lib/supabase/types";
import { TodayClient, type AssignedAppointment } from "./today-client";

export const metadata = { title: "Today" };
export const dynamic = "force-dynamic";

type RawAppointment = {
  id: string;
  customer_id: string;
  confirmation_code: string;
  pest_type: string;
  slot_start: string;
  slot_end: string;
  status: AppointmentStatus;
  assigned_technician_id: string | null;
  completed_at: string | null;
  customers: {
    id: string;
    name: string | null;
    address: string | null;
  } | null;
};

export default async function TechHomePage() {
  const session = await requireRole("technician");
  const supabase = await createSupabaseServerClient();

  const now = new Date();
  const windowStart = startOfDay(now);
  const windowEnd = addDays(windowStart, 2);

  const { data, error } = await supabase
    .from("appointments")
    .select(
      "id, customer_id, confirmation_code, pest_type, slot_start, slot_end, status, assigned_technician_id, completed_at, customers(id, name, address)"
    )
    .eq("assigned_technician_id", session.userId)
    .gte("slot_start", windowStart.toISOString())
    .lt("slot_start", windowEnd.toISOString())
    .order("slot_start", { ascending: true });

  if (error) {
    return <ErrorState message={error.message} />;
  }

  const rows = ((data ?? []) as unknown) as RawAppointment[];
  const appointments: AssignedAppointment[] = rows.map((r) => ({
    id: r.id,
    customer_id: r.customer_id,
    confirmation_code: r.confirmation_code,
    pest_type: r.pest_type,
    slot_start: r.slot_start,
    slot_end: r.slot_end,
    status: r.status,
    completed_at: r.completed_at,
    customer: r.customers
  }));

  const techName = session.profile.full_name?.trim() || null;

  return (
    <TodayClient
      initial={appointments}
      technicianId={session.userId}
      technicianName={techName}
    />
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="surface-paper min-h-dvh px-5 py-10">
      <div className="border border-destructive/40 bg-card px-5 py-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-destructive">
          Couldn&apos;t load your route
        </p>
        <p className="mt-2 text-sm text-foreground">{message}</p>
      </div>
    </div>
  );
}
