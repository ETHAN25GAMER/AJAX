import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { DispatchClient, type DispatchTech } from "./dispatch-client";

export const metadata = { title: "Dispatch" };
export const dynamic = "force-dynamic";

type RawPosition = {
  technician_id: string;
  appointment_id: string | null;
  lat: number;
  lng: number;
  updated_at: string;
};

export default async function DispatchPage() {
  await requireRole("admin");
  const sb = await createSupabaseServerClient();

  const { data: positions, error } = await sb
    .from("technician_positions")
    .select("technician_id, appointment_id, lat, lng, updated_at")
    .order("updated_at", { ascending: false });

  if (error) return <ErrorState message={error.message} />;

  const rows = (positions ?? []) as RawPosition[];
  const techIds = Array.from(new Set(rows.map((r) => r.technician_id)));
  const apptIds = Array.from(new Set(rows.map((r) => r.appointment_id).filter(Boolean) as string[]));

  const [profilesRes, apptsRes] = await Promise.all([
    techIds.length > 0
      ? sb.from("profiles").select("id, full_name").in("id", techIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null }> }),
    apptIds.length > 0
      ? sb
          .from("appointments")
          .select("id, confirmation_code, customer_id, customers(name)")
          .in("id", apptIds)
      : Promise.resolve({ data: [] as Array<unknown> })
  ]);

  const nameByTech = new Map<string, string>();
  for (const p of profilesRes.data ?? []) {
    nameByTech.set(p.id, p.full_name?.trim() || "Unnamed tech");
  }

  type ApptRow = {
    id: string;
    confirmation_code: string;
    customer_id: string;
    customers: { name: string | null } | null;
  };
  const apptInfo = new Map<string, { confirmation_code: string; customer_name: string | null }>();
  for (const a of ((apptsRes.data ?? []) as unknown) as ApptRow[]) {
    apptInfo.set(a.id, {
      confirmation_code: a.confirmation_code,
      customer_name: a.customers?.name ?? null
    });
  }

  const techs: DispatchTech[] = rows.map((r) => ({
    technician_id: r.technician_id,
    appointment_id: r.appointment_id,
    confirmation_code: r.appointment_id ? apptInfo.get(r.appointment_id)?.confirmation_code ?? null : null,
    customer_name: r.appointment_id ? apptInfo.get(r.appointment_id)?.customer_name ?? null : null,
    tech_name: nameByTech.get(r.technician_id) ?? "Unnamed tech",
    lat: r.lat,
    lng: r.lng,
    updated_at: r.updated_at
  }));

  return <DispatchClient initial={techs} />;
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="surface-paper min-h-dvh px-6 py-16 md:px-12">
      <div className="mx-auto max-w-2xl border border-destructive/40 bg-card px-6 py-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-destructive">
          Couldn&apos;t load dispatch
        </p>
        <p className="mt-2 text-sm text-foreground">{message}</p>
      </div>
    </div>
  );
}
