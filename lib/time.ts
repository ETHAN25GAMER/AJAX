import { formatDistanceToNowStrict, differenceInHours } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

// Every customer-facing time is rendered in India Standard Time (IST, UTC+5:30, no DST).
// Pinning the zone is what prevents hydration mismatches: the server runs in
// UTC (Vercel) while a browser runs in the visitor's own zone, so formatting
// "in the runtime's local time" produced two different strings for the same
// instant. Pinning to a fixed zone makes the output identical everywhere.
export const BUSINESS_TZ = "Asia/Kolkata";

// Flat-service visit length (service tiers were removed in migration 0020).
// 90 minutes fits every 2-hour work window and covers typical jobs; shared by
// check_availability, create_appointment, and reschedule_appointment so slot
// math can never disagree between them.
export const VISIT_DURATION_MIN = 90;

// Slot time in 24-hour HH:mm, always in IST.
export function formatSlotTime(iso: string): string {
  return formatInTimeZone(new Date(iso), BUSINESS_TZ, "HH:mm");
}

// "09:30 — 10:30" or just "09:30" if there's no end.
export function formatSlotRange(startIso: string, endIso?: string | null): string {
  const start = formatSlotTime(startIso);
  if (!endIso) return start;
  return `${start} — ${formatSlotTime(endIso)}`;
}

// YYYY-MM-DD partition key in IST. Used to group appointments into
// day buckets. Deterministic across server/client because the zone is fixed.
export function dayKey(iso: string): string {
  return formatInTimeZone(new Date(iso), BUSINESS_TZ, "yyyy-MM-dd");
}

// Day headers for grouped lists: "Today", "Tomorrow", or a calendar label —
// all relative to the current IST date.
export function dayHeader(iso: string): { eyebrow: string; title: string } {
  const key = dayKey(iso);
  const now = Date.now();
  const today = dayKey(new Date(now).toISOString());
  const tomorrow = dayKey(new Date(now + 86_400_000).toISOString());
  const yesterday = dayKey(new Date(now - 86_400_000).toISOString());
  const title = formatInTimeZone(new Date(iso), BUSINESS_TZ, "EEEE, d MMMM");

  if (key === today) return { eyebrow: "Today", title };
  if (key === tomorrow) return { eyebrow: "Tomorrow", title };
  if (key === yesterday) return { eyebrow: "Yesterday", title };
  return {
    eyebrow: formatInTimeZone(new Date(iso), BUSINESS_TZ, "EEE"),
    title: formatInTimeZone(new Date(iso), BUSINESS_TZ, "d MMMM")
  };
}

// Parse a slot_start supplied by the agent. If the string carries a timezone
// (trailing "Z" or a ±HH:MM offset) we honor it; a naive wall-clock string is
// interpreted as IST, since that's what the business operates in.
// This guards against the model emitting "2026-06-02T14:00:00" with no offset,
// which `new Date()` would otherwise read as the server's UTC clock.
export function parseBusinessTime(input: string): Date {
  const hasTz = /([zZ]|[+-]\d{2}:?\d{2})$/.test(input.trim());
  return hasTz ? new Date(input) : fromZonedTime(input, BUSINESS_TZ);
}

// Short calendar date in IST, e.g. "Mon, 2 Jun". Deterministic.
export function shortDate(iso: string): string {
  return formatInTimeZone(new Date(iso), BUSINESS_TZ, "EEE, d MMM");
}

// Deterministic, IST absolute label, e.g. "2 Jun, 14:30". Safe to
// render during SSR and the first client paint — used as the stable fallback
// by <RelativeTime> before it switches to the live "x ago" form.
export function absShort(iso: string): string {
  return formatInTimeZone(new Date(iso), BUSINESS_TZ, "d MMM, HH:mm");
}

// Short-form relative time used in dense triage views ("4m ago", "3h ago").
// Falls back to an absolute IST label for anything older than 24h.
//
// This reads the current clock, so it is NOT stable between the server render
// and client hydration — only call it AFTER mount (see <RelativeTime>), never
// directly during render.
export function shortAgo(iso: string): string {
  const date = new Date(iso);
  if (differenceInHours(new Date(), date) >= 24) {
    return absShort(iso);
  }
  return formatDistanceToNowStrict(date, { addSuffix: true })
    .replace(" minutes", "m")
    .replace(" minute", "m")
    .replace(" hours", "h")
    .replace(" hour", "h")
    .replace(" seconds", "s")
    .replace(" second", "s");
}
