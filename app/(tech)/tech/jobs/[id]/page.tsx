import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import type { AppointmentStatus } from "@/lib/supabase/types";
import { JobDetailClient, type JobDetail, type JobPhoto } from "./job-detail-client";

export const metadata = { title: "Job" };
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
  tech_notes: string | null;
  completed_at: string | null;
  tracking_state: "en_route" | "arrived" | null;
  assigned_technician_id: string | null;
  customers: {
    id: string;
    name: string | null;
    phone: string;
    address: string | null;
  } | null;
};

type RawPhoto = {
  id: string;
  storage_path: string;
  kind: "before" | "after" | "damage" | "other";
  taken_at: string;
};

const SIGNED_URL_TTL_SECONDS = 60 * 60;

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole("technician");
  const { id } = await params;
  const sb = await createSupabaseServerClient();

  const { data: rawAppt, error: apptErr } = await sb
    .from("appointments")
    .select(
      "id, customer_id, confirmation_code, pest_type, slot_start, slot_end, status, price_quoted, tech_notes, completed_at, tracking_state, assigned_technician_id, customers(id, name, phone, address)"
    )
    .eq("id", id)
    .maybeSingle();

  if (apptErr) {
    return <ErrorState message={apptErr.message} />;
  }
  const appt = (rawAppt as unknown) as RawAppointment | null;
  if (!appt) notFound();

  // RLS would already block, but make the redirect explicit so we don't render
  // a broken page if a tech somehow follows a stale link to a reassigned job.
  if (appt.assigned_technician_id !== session.userId) {
    notFound();
  }

  const { data: rawPhotos, error: photosErr } = await sb
    .from("appointment_photos")
    .select("id, storage_path, kind, taken_at")
    .eq("appointment_id", id)
    .order("taken_at", { ascending: true });

  if (photosErr) {
    return <ErrorState message={photosErr.message} />;
  }

  const photos: JobPhoto[] = [];
  for (const p of (rawPhotos ?? []) as RawPhoto[]) {
    const signed = await sb.storage
      .from("job-photos")
      .createSignedUrl(p.storage_path, SIGNED_URL_TTL_SECONDS);
    if (signed.data?.signedUrl) {
      photos.push({
        id: p.id,
        storage_path: p.storage_path,
        kind: p.kind,
        taken_at: p.taken_at,
        signed_url: signed.data.signedUrl
      });
    }
  }

  if (!appt.customers) {
    return <ErrorState message="This job has no customer record." />;
  }

  // Find a live tracking token (if any) so the tech UI can resume the trip
  // view on reload without forcing them to "Start travel" again.
  let trackingUrl: string | null = null;
  if (appt.tracking_state === "en_route" || appt.tracking_state === "arrived") {
    const { data: tokenRow } = await sb
      .from("appointment_tracking_tokens")
      .select("token")
      .eq("appointment_id", id)
      .eq("revoked", false)
      .maybeSingle();
    if (tokenRow?.token) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
      trackingUrl = `${baseUrl.replace(/\/$/, "")}/track/${tokenRow.token}`;
    }
  }

  const detail: JobDetail = {
    id: appt.id,
    customer_id: appt.customer_id,
    confirmation_code: appt.confirmation_code,
    pest_type: appt.pest_type,
    slot_start: appt.slot_start,
    slot_end: appt.slot_end,
    status: appt.status,
    price_quoted: appt.price_quoted,
    tech_notes: appt.tech_notes,
    completed_at: appt.completed_at,
    tracking_state: appt.tracking_state,
    tracking_url: trackingUrl,
    customer: appt.customers,
    photos
  };

  return <JobDetailClient initial={detail} />;
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="surface-paper min-h-dvh px-5 py-10">
      <div className="border border-destructive/40 bg-card px-5 py-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-destructive">
          Couldn&apos;t load this job
        </p>
        <p className="mt-2 text-sm text-foreground">{message}</p>
      </div>
    </div>
  );
}
