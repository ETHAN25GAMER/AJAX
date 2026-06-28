import type { SupabaseClient } from "@supabase/supabase-js";
import { dayKey, parseBusinessTime } from "@/lib/time";

// Pick the technician with the lightest load on the same Singapore calendar day
// as `slotStartIso`. Random tie-break. Returns null when no technicians exist
// (preserves the original "insert as NULL, admin picks" behavior).
//
// Counts only appointments that still consume a slot — `booked` and `completed`.
// Cancelled jobs free up capacity, so they don't count.
//
// Admin can still override via the dropdown on /admin/appointments — this is a
// starting assignment, not a lock.
export async function pickTechnician(
  slotStartIso: string,
  db: SupabaseClient
): Promise<string | null> {
  const { data: techs, error: techErr } = await db
    .from("profiles")
    .select("id")
    .eq("role", "technician");
  if (techErr) throw techErr;
  if (!techs || techs.length === 0) return null;

  const key = dayKey(slotStartIso);
  const dayStart = parseBusinessTime(`${key}T00:00:00`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const { data: rows, error: apptErr } = await db
    .from("appointments")
    .select("assigned_technician_id")
    .gte("slot_start", dayStart.toISOString())
    .lt("slot_start", dayEnd.toISOString())
    .in("status", ["booked", "completed"])
    .not("assigned_technician_id", "is", null);
  if (apptErr) throw apptErr;

  const load = new Map<string, number>();
  for (const t of techs) load.set(t.id, 0);
  for (const r of rows ?? []) {
    const id = r.assigned_technician_id as string | null;
    if (id && load.has(id)) load.set(id, (load.get(id) ?? 0) + 1);
  }

  let min = Infinity;
  for (const n of load.values()) if (n < min) min = n;

  const candidates: string[] = [];
  for (const [id, n] of load) if (n === min) candidates.push(id);

  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}
