"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";

export type ActionResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format");

const AmcCreateSchema = z.object({
  customer_id: z.string().uuid(),
  commenced_at: DateSchema,
  renews_at: DateSchema,
  lead_days: z.coerce.number().int().min(1).max(365).default(30),
  pest_type: z.string().min(1).max(80).transform((s) => s.trim().toLowerCase()),
  annual_price: z.coerce.number().min(0).max(1_000_000).nullable(),
  notes: z.string().max(500).nullable().optional()
});

const AmcUpdateSchema = z.object({
  commenced_at: DateSchema.optional(),
  renews_at: DateSchema.optional(),
  lead_days: z.coerce.number().int().min(1).max(365).optional(),
  pest_type: z.string().min(1).max(80).optional(),
  annual_price: z.coerce.number().min(0).max(1_000_000).nullable().optional(),
  notes: z.string().max(500).nullable().optional()
});

export async function createAmc(input: unknown): Promise<ActionResult<{ customer_id: string }>> {
  await requireRole("admin");
  const parsed = AmcCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const sb = await createSupabaseServerClient();
  const { error } = await sb.from("amc").insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/amc");
  return { ok: true, value: { customer_id: parsed.data.customer_id } };
}

export async function updateAmc(customerId: string, input: unknown): Promise<ActionResult> {
  await requireRole("admin");
  const parsed = AmcUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const sb = await createSupabaseServerClient();
  const { error } = await sb.from("amc").update(parsed.data).eq("customer_id", customerId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/amc");
  return { ok: true, value: undefined };
}

// Mark the current period as renewed: push renews_at out one year, clear the
// reminder/followup flags so the next cycle starts fresh, set status active.
export async function markRenewed(customerId: string): Promise<ActionResult> {
  await requireRole("admin");
  const sb = await createSupabaseServerClient();

  const { data: current, error: readErr } = await sb
    .from("amc")
    .select("renews_at")
    .eq("customer_id", customerId)
    .single();
  if (readErr) return { ok: false, error: readErr.message };

  const next = new Date(current.renews_at + "T00:00:00Z");
  next.setUTCFullYear(next.getUTCFullYear() + 1);
  const nextStr = next.toISOString().slice(0, 10);

  const { error } = await sb
    .from("amc")
    .update({
      renews_at: nextStr,
      status: "active",
      reminder_sent_at: null,
      followup_sent_at: null
    })
    .eq("customer_id", customerId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/amc");
  return { ok: true, value: undefined };
}

export async function markCancelled(customerId: string): Promise<ActionResult> {
  await requireRole("admin");
  const sb = await createSupabaseServerClient();
  const { error } = await sb
    .from("amc")
    .update({ status: "cancelled" })
    .eq("customer_id", customerId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/amc");
  return { ok: true, value: undefined };
}

export async function reactivate(customerId: string): Promise<ActionResult> {
  await requireRole("admin");
  const sb = await createSupabaseServerClient();
  const { error } = await sb
    .from("amc")
    .update({ status: "active" })
    .eq("customer_id", customerId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/amc");
  return { ok: true, value: undefined };
}
