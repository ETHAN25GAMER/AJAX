"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabase as serviceClient } from "@/lib/supabase/client";
import { requireRole } from "@/lib/auth/require-role";
import {
  sendFlowToCustomer,
  sendTemplateToCustomer,
  sendWhatsAppToCustomer
} from "@/lib/whatsapp/outbound";
import { TEMPLATES, TEMPLATE_LANG, bodyWithUrlButton, firstName } from "@/lib/whatsapp/templates";
import type { AppointmentStatus, Urgency } from "@/lib/supabase/types";

export type SimpleResult = { ok: true } | { ok: false; error: string };
export type DataResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function updateNotes(
  appointmentId: string,
  notes: string
): Promise<SimpleResult> {
  await requireRole("technician");
  const sb = await createSupabaseServerClient();

  const trimmed = notes.trim();
  const { error } = await sb
    .from("appointments")
    .update({ tech_notes: trimmed.length > 0 ? trimmed : null })
    .eq("id", appointmentId);

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/tech/jobs/${appointmentId}`);
  return { ok: true };
}

export async function setStatus(
  appointmentId: string,
  status: AppointmentStatus
): Promise<DataResult<{ completed_at: string | null }>> {
  const session = await requireRole("technician");
  const sb = await createSupabaseServerClient();

  const completed_at = status === "completed" ? new Date().toISOString() : null;
  const update: Record<string, unknown> = { status, completed_at };
  // Reaching a terminal state ends the trip in the same write — no stale
  // tracking links live after the job is done.
  if (status !== "booked") update.tracking_state = null;

  const { error } = await sb
    .from("appointments")
    .update(update)
    .eq("id", appointmentId);

  if (error) return { ok: false, error: error.message };

  if (status !== "booked") {
    await cleanupTrip(sb, appointmentId, session.userId);
  }

  // The RLS-scoped update above succeeding proves this tech owns the job, so
  // the system-side CSAT ask can safely run under the service role (same
  // pattern as createEscalation). Never fail the completion over it.
  if (status === "completed") {
    await requestCsat(appointmentId).catch((e) =>
      console.error("[csat] request failed", appointmentId, e)
    );
  }

  revalidatePath(`/tech/jobs/${appointmentId}`);
  revalidatePath("/tech");
  return { ok: true, data: { completed_at } };
}

// Ask the customer to rate the visit: a WhatsApp Flow when one is published
// (WHATSAPP_FLOW_CSAT_ID), else a plain reply-1-to-5 message. Transactional —
// it's about the service they just received, not marketing. Marked via
// csat_requested_at so it's asked exactly once and bare-number replies can be
// attributed (lib/feedback.ts). Free-form sends need Meta's 24h window; when
// it's closed the send fails and we simply don't mark — no rating ask, no lie.
async function requestCsat(appointmentId: string) {
  const admin = serviceClient();

  const { data: appt } = await admin
    .from("appointments")
    .select("id, csat_requested_at, customers(name, phone, opted_out)")
    .eq("id", appointmentId)
    .maybeSingle();
  if (!appt || appt.csat_requested_at) return;

  // Embedded relations are typed as arrays even on a one-to-one FK.
  const customer = (appt.customers as unknown) as
    | { name: string | null; phone: string | null; opted_out: boolean | null }
    | null;
  if (!customer?.phone) return;

  const forSend = { phone: customer.phone, opted_out: customer.opted_out };
  const flowId = process.env.WHATSAPP_FLOW_CSAT_ID;

  const gate = flowId
    ? await sendFlowToCustomer(
        forSend,
        {
          flowId,
          bodyText: `Thanks ${firstName(customer.name)} — your visit is complete. How did we do?`,
          ctaText: "Rate your visit",
          flowToken: `csat:${appointmentId}`
        },
        { kind: "transactional" }
      )
    : await sendWhatsAppToCustomer(
        forSend,
        `Thanks ${firstName(customer.name)} — your visit is complete. ` +
          `How did we do? Reply with a rating from 1 to 5.`,
        { kind: "transactional" }
      );

  if (gate.ok) {
    await admin
      .from("appointments")
      .update({ csat_requested_at: new Date().toISOString() })
      .eq("id", appointmentId);
  }
}

export type RecordedPhoto = {
  id: string;
  storage_path: string;
  kind: "before" | "after" | "damage" | "other";
  taken_at: string;
  signed_url: string;
};

export async function recordPhoto(
  appointmentId: string,
  storagePath: string,
  kind: RecordedPhoto["kind"]
): Promise<DataResult<RecordedPhoto>> {
  const session = await requireRole("technician");
  const sb = await createSupabaseServerClient();

  // RLS will also enforce this, but we want a clean error before inserting.
  if (!storagePath.startsWith(`${appointmentId}/`)) {
    return { ok: false, error: "Photo path doesn't match this appointment." };
  }

  const { data, error } = await sb
    .from("appointment_photos")
    .insert({
      appointment_id: appointmentId,
      storage_path: storagePath,
      kind,
      taken_by: session.userId
    })
    .select("id, storage_path, kind, taken_at")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Insert failed" };
  }

  const signed = await sb.storage.from("job-photos").createSignedUrl(data.storage_path, 3600);
  if (signed.error || !signed.data) {
    return { ok: false, error: signed.error?.message ?? "Could not sign URL" };
  }

  revalidatePath(`/tech/jobs/${appointmentId}`);
  return {
    ok: true,
    data: {
      id: data.id,
      storage_path: data.storage_path,
      kind: data.kind as RecordedPhoto["kind"],
      taken_at: data.taken_at,
      signed_url: signed.data.signedUrl
    }
  };
}

// --- GPS tracking ----------------------------------------------------------

type SupabaseSSR = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function cleanupTrip(sb: SupabaseSSR, appointmentId: string, technicianId: string) {
  await sb
    .from("appointment_tracking_tokens")
    .update({ revoked: true, revoked_at: new Date().toISOString() })
    .eq("appointment_id", appointmentId)
    .eq("revoked", false);

  await sb.from("technician_positions").delete().eq("technician_id", technicianId);
}

export async function startTrip(
  appointmentId: string
): Promise<DataResult<{ trackingUrl: string; whatsappWarning: string | null }>> {
  const session = await requireRole("technician");
  const sb = await createSupabaseServerClient();

  const { data: appt, error: apptErr } = await sb
    .from("appointments")
    .select(
      "id, customer_id, confirmation_code, assigned_technician_id, customers(name, phone, opted_out)"
    )
    .eq("id", appointmentId)
    .maybeSingle();

  if (apptErr) return { ok: false, error: apptErr.message };
  if (!appt || appt.assigned_technician_id !== session.userId) {
    return { ok: false, error: "Not authorized for this job." };
  }

  // Embedded relations are typed as arrays even on a one-to-one FK.
  const customer = (appt.customers as unknown) as
    | { name: string | null; phone: string; opted_out: boolean | null }
    | null;
  if (!customer) return { ok: false, error: "This job has no customer to notify." };

  // Insert a fresh token (unique partial index ensures one live token per appointment).
  const { data: tokenRow, error: tokenErr } = await sb
    .from("appointment_tracking_tokens")
    .insert({ appointment_id: appointmentId })
    .select("token")
    .single();

  if (tokenErr || !tokenRow) {
    return { ok: false, error: tokenErr?.message ?? "Could not create tracking token." };
  }

  await sb
    .from("appointments")
    .update({ tracking_state: "en_route" })
    .eq("id", appointmentId);

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
  const trackingUrl = `${baseUrl.replace(/\/$/, "")}/track/${tokenRow.token}`;
  const techName = session.profile.full_name?.trim() || "your technician";

  let whatsappWarning: string | null = null;
  try {
    // Sent day-of, usually outside the 24h window → approved template.
    // Transactional: the customer ordered this and needs to know the tech is
    // arriving; opt-out doesn't apply. Body: 1=first name, 2=tech; the live
    // tracking link is a dynamic URL button (token fills the button's {{1}}).
    await sendTemplateToCustomer(
      customer,
      TEMPLATES.enRoute,
      TEMPLATE_LANG,
      bodyWithUrlButton([firstName(customer.name), techName], tokenRow.token),
      { kind: "transactional" }
    );
  } catch (e) {
    // Don't fail the trip start if WhatsApp is misconfigured — the tracking
    // pipeline is already live; just surface the failure so the tech knows to
    // share the link manually (or fix Meta sandbox config).
    whatsappWarning = (e as Error).message;
  }

  revalidatePath(`/tech/jobs/${appointmentId}`);
  return { ok: true, data: { trackingUrl, whatsappWarning } };
}

export async function postPosition(
  appointmentId: string,
  lat: number,
  lng: number,
  accuracy: number | null,
  heading: number | null
): Promise<SimpleResult> {
  const session = await requireRole("technician");
  const sb = await createSupabaseServerClient();

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, error: "Invalid coordinates." };
  }

  const { data: appt } = await sb
    .from("appointments")
    .select("id")
    .eq("id", appointmentId)
    .eq("assigned_technician_id", session.userId)
    .maybeSingle();

  if (!appt) return { ok: false, error: "Not authorized for this job." };

  const { error } = await sb
    .from("technician_positions")
    .upsert(
      {
        technician_id: session.userId,
        appointment_id: appointmentId,
        lat,
        lng,
        accuracy_m: accuracy,
        heading,
        updated_at: new Date().toISOString()
      },
      { onConflict: "technician_id" }
    );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function endTrip(appointmentId: string): Promise<SimpleResult> {
  const session = await requireRole("technician");
  const sb = await createSupabaseServerClient();

  const { data: appt } = await sb
    .from("appointments")
    .select("id")
    .eq("id", appointmentId)
    .eq("assigned_technician_id", session.userId)
    .maybeSingle();

  if (!appt) return { ok: false, error: "Not authorized for this job." };

  await cleanupTrip(sb, appointmentId, session.userId);

  await sb
    .from("appointments")
    .update({ tracking_state: null })
    .eq("id", appointmentId);

  revalidatePath(`/tech/jobs/${appointmentId}`);
  return { ok: true };
}

// --- Escalations -----------------------------------------------------------

export async function createEscalation(
  appointmentId: string,
  summary: string,
  urgency: Urgency
): Promise<DataResult<{ id: string }>> {
  const session = await requireRole("technician");
  const sb = await createSupabaseServerClient();

  const trimmed = summary.trim();
  if (trimmed.length < 3) {
    return { ok: false, error: "Add a brief summary so dispatch knows what's up." };
  }

  // Tech ↔ customer linkage check: the appointment must be theirs.
  const { data: appt, error: apptErr } = await sb
    .from("appointments")
    .select("id, customer_id")
    .eq("id", appointmentId)
    .eq("assigned_technician_id", session.userId)
    .maybeSingle();

  if (apptErr) return { ok: false, error: apptErr.message };
  if (!appt) return { ok: false, error: "Not authorized for this job." };

  // No tech INSERT policy on escalations, so use service-role with app-level auth.
  const admin = serviceClient();
  const escalationId = randomUUID();
  const { error } = await admin.from("escalations").insert({
    id: escalationId,
    customer_id: appt.customer_id,
    summary: trimmed,
    urgency
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/tech/jobs/${appointmentId}`);
  revalidatePath("/admin/escalations");
  return { ok: true, data: { id: escalationId } };
}
