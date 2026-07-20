"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";

export type ActionResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const PricingUpdateSchema = z.object({
  base_price: z.coerce.number().min(0).max(100000),
  per_sqft: z.coerce.number().min(0).max(100),
  notes: z.string().max(280).nullable(),
  requires_inspection: z.boolean()
});

const PricingCreateSchema = z.object({
  pest_type: z.string().min(1).max(60).transform((s) => s.trim().toLowerCase()),
  base_price: z.coerce.number().min(0).max(100000),
  per_sqft: z.coerce.number().min(0).max(100),
  notes: z.string().max(280).nullable(),
  requires_inspection: z.boolean()
});

export async function updatePricing(
  id: string,
  input: unknown
): Promise<ActionResult> {
  await requireRole("admin");
  const parsed = PricingUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("pricing").update(parsed.data).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/pricing");
  return { ok: true, value: undefined };
}

export async function createPricing(input: unknown): Promise<ActionResult<{ id: string }>> {
  await requireRole("admin");
  const parsed = PricingCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("pricing")
    .insert(parsed.data)
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/pricing");
  return { ok: true, value: { id: data.id } };
}

export async function deletePricing(id: string): Promise<ActionResult> {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("pricing").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/pricing");
  return { ok: true, value: undefined };
}
