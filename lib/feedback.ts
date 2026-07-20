import { supabase } from "@/lib/supabase/client";

// Post-visit CSAT: recording ratings and shaping the thank-you reply.
//
// Two entry paths converge here (both in the webhook):
//   * a completed CSAT Flow (nfm_reply with a `rating` field), and
//   * the plain-text fallback — the customer replies a bare "1".."5" while a
//     recent rating request is outstanding (appointments.csat_requested_at).
// Both store one feedback row per appointment; ratings of 4+ earn a Google
// review nudge when GOOGLE_REVIEW_URL is configured.

export const CSAT_ATTRIBUTION_DAYS = 7;

// A lone "1".."5" (allowing "5 stars", "4/5"-style noise is NOT attempted —
// exact digits only, mirroring the strictness of opt-out matching).
export function parseBareRating(text: string): number | null {
  const t = text.trim();
  if (!/^[1-5]$/.test(t)) return null;
  return Number(t);
}

export function extractFlowRating(
  fields: Record<string, unknown>
): { rating: number; comment: string | null } | null {
  const raw = fields.rating;
  const rating =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  const comment =
    typeof fields.comment === "string" && fields.comment.trim() !== ""
      ? fields.comment.trim()
      : null;
  return { rating, comment };
}

export type RecordCsatResult =
  | { stored: true; rating: number }
  | { stored: false; reason: "no_outstanding_request" | "db_error" };

// Attribute a rating to the customer's most recent completed appointment with
// an outstanding CSAT request, and store it. The unique(appointment_id)
// constraint makes re-submissions harmless (23505 → treated as already stored).
export async function recordCsat(
  customerId: string,
  rating: number,
  comment: string | null
): Promise<RecordCsatResult> {
  const db = supabase();
  const windowStart = new Date(Date.now() - CSAT_ATTRIBUTION_DAYS * 86_400_000).toISOString();

  const appt = await db
    .from("appointments")
    .select("id")
    .eq("customer_id", customerId)
    .eq("status", "completed")
    .not("csat_requested_at", "is", null)
    .gte("csat_requested_at", windowStart)
    .order("csat_requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (appt.error) {
    console.error("[feedback] appointment lookup failed", appt.error.message);
    return { stored: false, reason: "db_error" };
  }
  if (!appt.data) return { stored: false, reason: "no_outstanding_request" };

  const ins = await db.from("feedback").insert({
    appointment_id: appt.data.id,
    customer_id: customerId,
    rating,
    comment
  });

  if (ins.error && ins.error.code !== "23505") {
    console.error("[feedback] insert failed", ins.error.message);
    return { stored: false, reason: "db_error" };
  }
  return { stored: true, rating };
}

export function csatThanksText(rating: number): string {
  if (rating >= 4) {
    const reviewUrl = process.env.GOOGLE_REVIEW_URL;
    const reviewLine = reviewUrl
      ? ` If you have a spare minute, a Google review really helps us: ${reviewUrl}`
      : "";
    return `Thank you — glad the visit went well!${reviewLine}`;
  }
  return (
    "Thank you for the honest feedback — sorry the visit fell short. " +
    "A member of our team will follow up with you to make it right."
  );
}

// Low ratings deserve a human look, not just a stored row.
export async function escalateLowRating(customerId: string, rating: number): Promise<void> {
  if (rating >= 4) return;
  const db = supabase();
  const { error } = await db.from("escalations").insert({
    customer_id: customerId,
    summary: `Customer rated their recent visit ${rating}/5. Please follow up.`,
    urgency: rating <= 2 ? "high" : "normal"
  });
  if (error) console.error("[feedback] low-rating escalation failed", error.message);
}

// A completed booking-intake Flow, flattened into a message the agent can act
// on through its normal tools — no separate booking path to maintain.
export function intakeToUserText(fields: Record<string, unknown>): string {
  const lines = Object.entries(fields)
    .filter(([, v]) => typeof v === "string" && (v as string).trim() !== "")
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${(v as string).trim()}`);
  return (
    "I filled in your booking form. Here are my details:\n" +
    (lines.length > 0 ? lines.join("\n") : "(form was empty)")
  );
}
