import { NextResponse } from "next/server";
import { supabase as serviceClient } from "@/lib/supabase/client";
import { isTripActive, servablePosition } from "@/lib/tracking";

export const dynamic = "force-dynamic";

type ResponseBody =
  | {
      status: "en_route" | "arrived";
      tech_name: string;
      confirmation_code: string;
      position: { lat: number; lng: number; updated_at: string } | null;
      destination: { lat: number; lng: number } | null;
    }
  | { status: "revoked" };

export async function GET(
  _req: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const sb = serviceClient();

  const { data: tokenRow, error: tokenErr } = await sb
    .from("appointment_tracking_tokens")
    .select("token, appointment_id, revoked")
    .eq("token", token)
    .maybeSingle();

  if (tokenErr) return NextResponse.json({ error: tokenErr.message }, { status: 500 });
  if (!tokenRow) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (tokenRow.revoked) {
    return NextResponse.json({ status: "revoked" } satisfies ResponseBody);
  }

  const { data: appt } = await sb
    .from("appointments")
    .select(
      "id, confirmation_code, tracking_state, assigned_technician_id, customer_id, customers(address_lat, address_lng)"
    )
    .eq("id", tokenRow.appointment_id)
    .maybeSingle();

  if (!appt) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // The trip must be actively shared. If it's been stopped/completed (or never
  // properly started), treat the link as ended rather than leaking a position.
  if (!isTripActive(appt.tracking_state)) {
    return NextResponse.json({ status: "revoked" } satisfies ResponseBody);
  }

  // Embedded relations type as arrays even for single FK.
  const customer = (appt.customers as unknown) as
    | { address_lat: number | null; address_lng: number | null }
    | null;

  const [{ data: position }, { data: techProfile }] = await Promise.all([
    sb
      .from("technician_positions")
      .select("lat, lng, updated_at, appointment_id")
      .eq("technician_id", appt.assigned_technician_id ?? "")
      .maybeSingle(),
    appt.assigned_technician_id
      ? sb
          .from("profiles")
          .select("full_name")
          .eq("id", appt.assigned_technician_id)
          .maybeSingle()
      : Promise.resolve({ data: null })
  ]);

  const techName = techProfile?.full_name?.trim() || "Your technician";
  const status = (appt.tracking_state === "arrived" ? "arrived" : "en_route") as
    | "en_route"
    | "arrived";

  // Only serve a position bound to this job and recent enough to be live.
  const livePosition = servablePosition(position, appt.id);

  const body: ResponseBody = {
    status,
    tech_name: techName,
    confirmation_code: appt.confirmation_code,
    position: livePosition
      ? { lat: livePosition.lat, lng: livePosition.lng, updated_at: livePosition.updated_at }
      : null,
    destination:
      customer?.address_lat != null && customer?.address_lng != null
        ? { lat: customer.address_lat, lng: customer.address_lng }
        : null
  };

  return NextResponse.json(body);
}
