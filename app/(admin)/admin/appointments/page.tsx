import { addDays, startOfDay } from "date-fns";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import type { AppointmentStatus } from "@/lib/supabase/types";
import {
  AppointmentsClient,
  type AppointmentWithCustomer,
  type TechnicianOption
} from "./appointments-client";

export const metadata = { title: "Appointments" };
export const dynamic = "force-dynamic";

type RawAppointment = {
  id: string;
  customer_id: string;
  confirmation_code: string;
  pest_type: string;
  slot_start: string;
  slot_end: string;
  status: AppointmentStatus;
  price_quoted: number | null;
  reminder_confirmed_at: string | null;
  assigned_technician_id: string | null;
  customers: {
    id: string;
    phone: string;
    name: string | null;
  } | null;
};

const HORIZON_DAYS = 3;

export default async function AppointmentsPage() {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();

  const now = new Date();
  const windowStart = startOfDay(now);
  const windowEnd = addDays(windowStart, HORIZON_DAYS);

  const [apptsResult, techsResult] = await Promise.all([
    supabase
      .from("appointments")
      .select(
        "id, customer_id, confirmation_code, pest_type, slot_start, slot_end, status, price_quoted, reminder_confirmed_at, assigned_technician_id, customers(id, phone, name)"
      )
      .gte("slot_start", windowStart.toISOString())
      .lt("slot_start", windowEnd.toISOString())
      .order("slot_start", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, full_name, phone")
      .eq("role", "technician")
      .order("full_name", { ascending: true })
  ]);

  if (apptsResult.error || techsResult.error) {
    return (
      <ErrorState message={apptsResult.error?.message ?? techsResult.error?.message ?? ""} />
    );
  }

  const rows = ((apptsResult.data ?? []) as unknown) as RawAppointment[];

  const appointments: AppointmentWithCustomer[] = rows.map((r) => ({
    id: r.id,
    customer_id: r.customer_id,
    confirmation_code: r.confirmation_code,
    pest_type: r.pest_type,
    slot_start: r.slot_start,
    slot_end: r.slot_end,
    status: r.status,
    price_quoted: r.price_quoted,
    reminder_confirmed_at: r.reminder_confirmed_at,
    assigned_technician_id: r.assigned_technician_id,
    customer: r.customers
  }));

  const technicians: TechnicianOption[] = (techsResult.data ?? []).map((t) => ({
    id: t.id,
    label: (t.full_name ?? t.phone ?? t.id.slice(0, 8)).trim() || t.id.slice(0, 8)
  }));

  return (
    <AppointmentsClient
      initial={appointments}
      technicians={technicians}
      horizonDays={HORIZON_DAYS}
    />
  );
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
