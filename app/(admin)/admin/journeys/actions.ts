"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";

export type ActionResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const StepSchema = z.object({
  delay_days: z.coerce.number().int().min(0).max(365),
  // Meta template names: lowercase alphanumerics + underscores.
  template_name: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9_]+$/, "Template names are lowercase letters, digits, and underscores"),
  template_params: z.array(z.string().max(200)).max(3)
});

const JourneyCreateSchema = z.object({
  name: z.string().min(1).max(120).transform((s) => s.trim()),
  trigger: z.enum(["job_completed", "customer_created"]),
  steps: z.array(StepSchema).min(1).max(10)
});

// Create a journey with its steps, disabled. Enabling is a separate, deliberate
// action so a half-composed sequence can't fire.
export async function createJourney(input: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await requireRole("admin");
  const parsed = JourneyCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const sb = await createSupabaseServerClient();
  const journey = await sb
    .from("journeys")
    .insert({
      name: parsed.data.name,
      trigger: parsed.data.trigger,
      enabled: false,
      created_by: session.userId
    })
    .select("id")
    .single();
  if (journey.error) return { ok: false, error: journey.error.message };

  const steps = parsed.data.steps.map((s, i) => ({
    journey_id: journey.data.id,
    position: i + 1,
    delay_days: s.delay_days,
    template_name: s.template_name,
    template_params: s.template_params.map((p) => p.trim()).filter((p) => p !== "")
  }));
  const ins = await sb.from("journey_steps").insert(steps);
  if (ins.error) {
    // Don't leave a step-less shell behind.
    await sb.from("journeys").delete().eq("id", journey.data.id);
    return { ok: false, error: ins.error.message };
  }

  revalidatePath("/admin/journeys");
  return { ok: true, value: { id: journey.data.id } };
}

// Enabling stamps enabled_at — the enrollment watermark. Only trigger events
// AFTER this instant enroll, so a newly enabled journey never blasts history.
export async function setJourneyEnabled(id: string, enabled: boolean): Promise<ActionResult> {
  await requireRole("admin");
  const sb = await createSupabaseServerClient();
  const { error } = await sb
    .from("journeys")
    .update(
      enabled ? { enabled: true, enabled_at: new Date().toISOString() } : { enabled: false }
    )
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/journeys");
  return { ok: true, value: undefined };
}

export async function deleteJourney(id: string): Promise<ActionResult> {
  await requireRole("admin");
  const sb = await createSupabaseServerClient();
  // Disabled only — an active journey with live enrollments is not clutter.
  const { data, error } = await sb
    .from("journeys")
    .delete()
    .eq("id", id)
    .eq("enabled", false)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "Disable the journey before deleting it." };
  }
  revalidatePath("/admin/journeys");
  return { ok: true, value: undefined };
}
