import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DeploymentTier } from "@/lib/supabase/types";

// Single source of truth for "what tier is this deployment on?". Backed by the
// singleton `deployment_settings` row (id=1). Defaults to 'tier2' when the row
// is missing or the query errors, so the worst-case behavior is "tier-3 features
// stay hidden" rather than "tier-3 features leak".
//
// Wrapped in React `cache()` so the admin layout and any page rendered inside it
// share one query per request.

export const getDeploymentTier = cache(async (): Promise<DeploymentTier> => {
  try {
    const sb = await createSupabaseServerClient();
    const { data, error } = await sb
      .from("deployment_settings")
      .select("tier")
      .eq("id", 1)
      .maybeSingle<{ tier: DeploymentTier }>();
    if (error || !data) return "tier2";
    return data.tier;
  } catch {
    return "tier2";
  }
});

export async function setDeploymentTier(
  tier: DeploymentTier,
  sb: SupabaseClient,
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await sb
    .from("deployment_settings")
    .update({ tier, updated_at: new Date().toISOString(), updated_by: userId })
    .eq("id", 1);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function getDeploymentSettings(sb: SupabaseClient) {
  const { data } = await sb
    .from("deployment_settings")
    .select("id, tier, updated_at, updated_by")
    .eq("id", 1)
    .maybeSingle<{
      id: number;
      tier: DeploymentTier;
      updated_at: string;
      updated_by: string | null;
    }>();
  return (
    data ?? {
      id: 1,
      tier: "tier2" as DeploymentTier,
      updated_at: new Date(0).toISOString(),
      updated_by: null
    }
  );
}
