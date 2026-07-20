"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Tags are lowercase slugs so "VIP" and "vip" can't drift into two tags.
const TagsSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(40)
      .transform((s) => s.trim().toLowerCase())
  )
  .max(20);

export async function updateTags(customerId: string, tags: unknown): Promise<ActionResult> {
  await requireRole("admin");
  const parsed = TagsSchema.safeParse(tags);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid tags" };
  }

  const sb = await createSupabaseServerClient();
  const unique = Array.from(new Set(parsed.data.filter((t) => t !== "")));
  const { error } = await sb.from("customers").update({ tags: unique }).eq("id", customerId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/customers");
  return { ok: true };
}

export async function updateCustomerNotes(
  customerId: string,
  notes: string
): Promise<ActionResult> {
  await requireRole("admin");
  const trimmed = notes.trim().slice(0, 2000);

  const sb = await createSupabaseServerClient();
  const { error } = await sb
    .from("customers")
    .update({ notes: trimmed === "" ? null : trimmed })
    .eq("id", customerId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/customers");
  return { ok: true };
}
