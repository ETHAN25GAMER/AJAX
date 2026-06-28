import { supabase } from "@/lib/supabase/client";

async function main() {
  const db = supabase();
  const { data, error } = await db
    .from("deployment_settings")
    .select("id, tier, updated_at, updated_by")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error("❌ migration NOT applied — query failed:");
    console.error("  ", error.message);
    process.exit(1);
  }

  if (!data) {
    console.error("⚠️  table exists but seed row missing — re-run the migration's INSERT.");
    process.exit(2);
  }

  console.log("✅ migration applied");
  console.log("   row:", data);
}

main();
