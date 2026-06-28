// Server-side gate for the public /track endpoints.
//
// The tracking link exposes a technician's live GPS and the customer's home
// coordinates, so the read path must never serve a position beyond the job and
// time window the link was issued for — even when a trip is never formally
// stopped (tech closes the app, loses signal, or forgets to tap "Stop"). The
// happy-path cleanup (token revoke + position delete) handles the normal case;
// this is the defense-in-depth that holds when it doesn't run.

export const TRACK_POSITION_MAX_AGE_MS = 15 * 60_000; // 15 minutes

export type TrackingState = "en_route" | "arrived" | null | undefined;

// A trip is "live" only while the technician has explicitly started it.
export function isTripActive(state: TrackingState): boolean {
  return state === "en_route" || state === "arrived";
}

// Only serve a position that (a) belongs to THIS appointment and (b) is recent.
// technician_positions is one row per technician, so without the appointment
// binding a stale link could read the tech's location on a *different*
// customer's job once they move on.
export function servablePosition<
  T extends { appointment_id?: string | null; updated_at: string }
>(position: T | null | undefined, appointmentId: string, now: number = Date.now()): T | null {
  if (!position) return null;
  if (position.appointment_id !== appointmentId) return null;
  const age = now - new Date(position.updated_at).getTime();
  if (!Number.isFinite(age) || age > TRACK_POSITION_MAX_AGE_MS) return null;
  return position;
}
