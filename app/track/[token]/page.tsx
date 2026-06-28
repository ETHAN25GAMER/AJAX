import { notFound } from "next/navigation";
import { supabase as serviceClient } from "@/lib/supabase/client";
import { geocodeAddress } from "@/lib/geo";
import { isTripActive, servablePosition } from "@/lib/tracking";
import { TrackClient, type TrackInitial } from "./track-client";
import { BRAND } from "@/lib/brand";

// Customer-facing: tab shows the company, not the staff console name.
export const metadata = { title: { absolute: `Live tracking — ${BRAND.company}` } };
export const dynamic = "force-dynamic";

export default async function TrackPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const sb = serviceClient();

  const { data: tokenRow } = await sb
    .from("appointment_tracking_tokens")
    .select("token, appointment_id, revoked")
    .eq("token", token)
    .maybeSingle();

  if (!tokenRow) notFound();

  if (tokenRow.revoked) {
    return <RevokedView />;
  }

  const { data: appt } = await sb
    .from("appointments")
    .select(
      "id, confirmation_code, tracking_state, assigned_technician_id, customer_id, customers(name, address, address_lat, address_lng)"
    )
    .eq("id", tokenRow.appointment_id)
    .maybeSingle();

  if (!appt) notFound();

  // Trip stopped/completed (or never started) — don't render a live position.
  if (!isTripActive(appt.tracking_state)) {
    return <RevokedView />;
  }

  const customer = (appt.customers as unknown) as
    | {
        name: string | null;
        address: string | null;
        address_lat: number | null;
        address_lng: number | null;
      }
    | null;

  // Geocode lazily: if we don't have coordinates cached and we have a string
  // address, look it up once and persist on the customer row. Failure is fine
  // — the map will just hide the destination marker.
  let destLat = customer?.address_lat ?? null;
  let destLng = customer?.address_lng ?? null;
  if (
    (destLat == null || destLng == null) &&
    customer?.address &&
    appt.customer_id
  ) {
    const coords = await geocodeAddress(customer.address);
    if (coords) {
      destLat = coords.lat;
      destLng = coords.lng;
      await sb
        .from("customers")
        .update({ address_lat: coords.lat, address_lng: coords.lng })
        .eq("id", appt.customer_id);
    }
  }

  const techName = appt.assigned_technician_id
    ? (
        await sb
          .from("profiles")
          .select("full_name")
          .eq("id", appt.assigned_technician_id)
          .maybeSingle()
      ).data?.full_name?.trim() || "Your technician"
    : "Your technician";

  const { data: rawPosition } = appt.assigned_technician_id
    ? await sb
        .from("technician_positions")
        .select("lat, lng, updated_at, appointment_id")
        .eq("technician_id", appt.assigned_technician_id)
        .maybeSingle()
    : { data: null };

  // Only seed a position bound to this job and recent enough to be live.
  const position = servablePosition(rawPosition, appt.id);

  const initial: TrackInitial = {
    token,
    techName,
    confirmationCode: appt.confirmation_code,
    customerName: customer?.name ?? null,
    customerAddress: customer?.address ?? null,
    destination: destLat != null && destLng != null ? { lat: destLat, lng: destLng } : null,
    position: position
      ? { lat: position.lat, lng: position.lng, updated_at: position.updated_at }
      : null,
    status: appt.tracking_state === "arrived" ? "arrived" : "en_route"
  };

  return <TrackClient initial={initial} />;
}

function RevokedView() {
  return (
    <div className="surface-paper min-h-dvh">
      <div className="mx-auto max-w-md px-5 pb-10 pt-12 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {BRAND.company} · Live tracking
        </p>
        <h1 className="mt-6 font-serif text-[40px] leading-[1.05] tracking-tight text-ink">
          Job complete.
        </h1>
        <p className="mt-3 text-[14px] text-muted-foreground">
          Your technician has wrapped up. Thanks for choosing {BRAND.company}.
        </p>
      </div>
    </div>
  );
}
