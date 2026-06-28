"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";

export type ResolveResult = { ok: true } | { ok: false; error: string };

export async function resolveEscalation(id: string): Promise<ResolveResult> {
  await requireRole("admin");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("escalations")
    .update({ resolved: true })
    .eq("id", id);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/escalations");
  return { ok: true };
}
