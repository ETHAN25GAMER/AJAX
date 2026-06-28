/**
 * KPI demo seed (minimal): flip the existing booked appointments into a realistic
 * completed/cancelled mix so the /admin/kpi dashboard populates for a demo.
 *
 *   - assigns the unassigned appointments to the 2nd technician
 *   - marks most completed (completed_at = slot_start + 90min)
 *   - leaves one cancelled so the funnel + cancellation rate aren't empty
 *
 * Keeps each appointment's existing price_quoted. Reversible: re-run with
 * `--revert` to set everything back to booked / unassigned-as-before is NOT
 * restored, but status+completed_at are cleared.
 *
 * Run:        npx tsx --env-file=.env.local scripts/seed-kpi-demo.ts
 * Revert:     npx tsx --env-file=.env.local scripts/seed-kpi-demo.ts --revert
 */
import { supabase } from "@/lib/supabase/client";

const REVERT = process.argv.includes("--revert");
const NINETY_MIN_MS = 90 * 60 * 1000;

async function main() {
  const db = supabase();

  // Need a 2nd technician to assign the currently-unassigned jobs to.
  const { data: techs, error: techErr } = await db
    .from("profiles")
    .select("id")
    .eq("role", "technician");
  if (techErr) throw new Error(`tech lookup failed: ${techErr.message}`);
  const techIds = (techs ?? []).map((t: any) => t.id);
  if (techIds.length < 1) throw new Error("no technicians found to assign to");

  const { data: appts, error } = await db
    .from("appointments")
    .select("id, status, slot_start, assigned_technician_id, price_quoted")
    .order("slot_start", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (appts ?? []) as any[];

  if (REVERT) {
    for (const a of rows) {
      const { error: e } = await db
        .from("appointments")
        .update({ status: "booked", completed_at: null })
        .eq("id", a.id);
      if (e) throw new Error(`revert ${a.id}: ${e.message}`);
    }
    console.log(`Reverted ${rows.length} appointments to booked (completed_at cleared).`);
    return;
  }

  // Pick the technician that currently has the fewest assignments as the "2nd"
  // tech to absorb the unassigned jobs, so both techs end up with work.
  const counts = new Map<string, number>(techIds.map((id: string) => [id, 0]));
  for (const a of rows) {
    if (a.assigned_technician_id && counts.has(a.assigned_technician_id)) {
      counts.set(a.assigned_technician_id, counts.get(a.assigned_technician_id)! + 1);
    }
  }
  const secondTech =
    [...counts.entries()].sort((x, y) => x[1] - y[1])[0]?.[0] ?? techIds[0];

  // Leave exactly one (the last by slot) cancelled for funnel/cancellation shape.
  const cancelId = rows[rows.length - 1]?.id;

  let completed = 0;
  let cancelled = 0;
  let assigned = 0;

  for (const a of rows) {
    const tech = a.assigned_technician_id ?? secondTech;
    if (!a.assigned_technician_id) assigned++;

    if (a.id === cancelId) {
      const { error: e } = await db
        .from("appointments")
        .update({ status: "cancelled", assigned_technician_id: tech, completed_at: null })
        .eq("id", a.id);
      if (e) throw new Error(`cancel ${a.id}: ${e.message}`);
      cancelled++;
      continue;
    }

    const completedAt = new Date(new Date(a.slot_start).getTime() + NINETY_MIN_MS).toISOString();
    const { error: e } = await db
      .from("appointments")
      .update({ status: "completed", assigned_technician_id: tech, completed_at: completedAt })
      .eq("id", a.id);
    if (e) throw new Error(`complete ${a.id}: ${e.message}`);
    completed++;
  }

  console.log(
    `KPI demo seeded — ${completed} completed, ${cancelled} cancelled, ${assigned} newly assigned (to ${secondTech.slice(0, 8)}).`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
