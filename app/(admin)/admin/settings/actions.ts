"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { setDeploymentTier } from "@/lib/tier";
import type { DeploymentTier } from "@/lib/supabase/types";

export type TierUpdateResult = { ok: true } | { ok: false; error: string };

export async function updateTier(tier: DeploymentTier): Promise<TierUpdateResult> {
  const session = await requireRole("admin");
  const sb = await createSupabaseServerClient();
  const result = await setDeploymentTier(tier, sb, session.userId);
  if (!result.ok) return result;

  revalidatePath("/admin", "layout");
  revalidatePath("/admin/kpi");
  revalidatePath("/admin/settings");
  return { ok: true };
}
