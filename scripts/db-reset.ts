/**
 * Strips all client data from the database — run before onboarding a new client.
 * Deletes: pricing, customers (cascades to conversations/appointments/amc/escalations),
 *          technician_positions, appointment_tracking_tokens.
 * Does NOT touch: profiles, auth.users.
 *
 * Run: npx tsx --env-file=.env.local scripts/db-reset.ts
 */
import { supabase } from "@/lib/supabase/client";

async function main() {
  const db = supabase();

  console.log("Clearing technician_positions...");
  const r1 = await db.from("technician_positions").delete().not("technician_id", "is", null);
  if (r1.error) throw new Error(r1.error.message);

  console.log("Clearing customers (cascades appointments/tracking_tokens/conversations/amc/escalations)...");
  const r2 = await db.from("customers").delete().not("id", "is", null);
  if (r2.error) throw new Error(r2.error.message);

  console.log("Clearing pricing...");
  const r3 = await db.from("pricing").delete().not("id", "is", null);
  if (r3.error) throw new Error(r3.error.message);

  console.log("Done — database is clean and ready for a new client.");
}

main().catch((e) => { console.error(e); process.exit(1); });
