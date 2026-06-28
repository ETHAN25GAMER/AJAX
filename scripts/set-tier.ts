/**
 * Manually set a client deployment's tier (tier2 <-> tier3).
 *
 * Each client is its own isolated Supabase project (Option A), so this script
 * targets exactly one client: the one whose SUPABASE_URL / SERVICE_ROLE_KEY are
 * loaded into the environment. Pick the client by choosing which env file you load.
 *
 *   # upgrade the client in clients/wayne-pesticide to tier 3
 *   npx tsx --env-file=clients/wayne-pesticide/.env.local scripts/set-tier.ts tier3
 *
 *   # using the repo-root .env.local (the npm shortcut):
 *   npm run set-tier -- tier3        # upgrade
 *   npm run set-tier -- tier2        # downgrade
 *   npm run set-tier                 # no arg: prints current tier, changes nothing
 *
 * Uses the service-role client, so it bypasses RLS — run it from a trusted machine.
 */
import { supabase } from "@/lib/supabase/client";
import type { DeploymentTier } from "@/lib/supabase/types";

const VALID: DeploymentTier[] = ["tier2", "tier3"];

function projectRef(url: string | undefined): string {
  if (!url) return "(unknown project)";
  try {
    return new URL(url).host; // e.g. abcd1234.supabase.co — confirms WHICH client you're hitting
  } catch {
    return url;
  }
}

async function main() {
  const db = supabase();
  const project = projectRef(process.env.SUPABASE_URL);

  // 1. Read the current singleton row.
  const { data: before, error: readErr } = await db
    .from("deployment_settings")
    .select("id, tier, updated_at, updated_by")
    .eq("id", 1)
    .maybeSingle<{ id: number; tier: DeploymentTier; updated_at: string; updated_by: string | null }>();

  if (readErr) {
    console.error(`❌ Could not read deployment_settings on ${project}.`);
    console.error("   ", readErr.message);
    console.error("   Has migration 0009_deployment_tier.sql been applied to this project?");
    process.exit(1);
  }
  if (!before) {
    console.error(`❌ deployment_settings has no id=1 row on ${project}.`);
    console.error("   Re-run the INSERT in 0009_deployment_tier.sql for this project.");
    process.exit(2);
  }

  // 2. Parse the requested tier (no arg = report-only).
  const requested = process.argv[2] as DeploymentTier | undefined;

  if (!requested) {
    console.log(`Project : ${project}`);
    console.log(`Current : ${before.tier}`);
    console.log("\nNo tier argument given — nothing changed.");
    console.log("Pass `tier3` to upgrade or `tier2` to downgrade.");
    return;
  }

  if (!VALID.includes(requested)) {
    console.error(`❌ Invalid tier "${requested}". Use one of: ${VALID.join(", ")}.`);
    process.exit(3);
  }

  if (before.tier === requested) {
    console.log(`Project : ${project}`);
    console.log(`Already on ${requested} — nothing to do.`);
    return;
  }

  // 3. Write the new tier. updated_by stays null: a manual/CLI change has no auth user.
  const { error: writeErr } = await db
    .from("deployment_settings")
    .update({ tier: requested, updated_at: new Date().toISOString(), updated_by: null })
    .eq("id", 1);

  if (writeErr) {
    console.error(`❌ Failed to update tier on ${project}.`);
    console.error("   ", writeErr.message);
    process.exit(4);
  }

  // 4. Verify.
  const { data: after } = await db
    .from("deployment_settings")
    .select("tier, updated_at")
    .eq("id", 1)
    .maybeSingle<{ tier: DeploymentTier; updated_at: string }>();

  console.log(`Project : ${project}`);
  console.log(`Tier    : ${before.tier} -> ${after?.tier ?? requested}`);
  if (requested === "tier3") {
    console.log("\n✅ Upgraded. /admin/kpi is now unlocked for this client.");
  } else {
    console.log("\n✅ Downgraded. /admin/kpi is now hidden for this client.");
  }
  console.log("Reload the admin console (the tier is cached per-request) to see the change.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
