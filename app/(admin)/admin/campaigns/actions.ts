"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { resolveSegment, type SegmentSpec } from "@/lib/campaigns/segment";

export type ActionResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const SegmentSchema = z.object({
  area: z.string().max(120).optional(),
  pest_type: z.string().max(60).optional(),
  last_visit_before_months: z.coerce.number().int().min(1).max(60).optional(),
  has_amc: z.boolean().optional(),
  tag: z.string().max(60).optional()
});

const CampaignCreateSchema = z.object({
  name: z.string().min(1).max(120).transform((s) => s.trim()),
  // Meta template names: lowercase alphanumerics + underscores.
  template_name: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9_]+$/, "Template names are lowercase letters, digits, and underscores"),
  template_params: z.array(z.string().max(200)).max(3),
  segment: SegmentSchema
});

// Count the audience a segment would reach right now — the compose form's
// live preview. Read-only; runs under the admin's RLS grants.
export async function previewSegment(input: unknown): Promise<ActionResult<{ count: number }>> {
  await requireRole("admin");
  const parsed = SegmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid segment" };
  }

  const sb = await createSupabaseServerClient();
  const resolved = await resolveSegment(sb, parsed.data as SegmentSpec);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  return { ok: true, value: { count: resolved.customerIds.length } };
}

// Create a draft campaign and snapshot its recipients as queued. Launch is a
// separate, deliberate step so the admin sees the final audience count first.
export async function createCampaign(input: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await requireRole("admin");
  const parsed = CampaignCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const sb = await createSupabaseServerClient();
  const resolved = await resolveSegment(sb, parsed.data.segment as SegmentSpec);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  if (resolved.customerIds.length === 0) {
    return { ok: false, error: "That segment matches no reachable customers." };
  }

  const campaign = await sb
    .from("campaigns")
    .insert({
      name: parsed.data.name,
      template_name: parsed.data.template_name,
      template_params: parsed.data.template_params,
      segment: parsed.data.segment,
      status: "draft",
      created_by: session.userId
    })
    .select("id")
    .single();
  if (campaign.error) return { ok: false, error: campaign.error.message };

  const recipients = resolved.customerIds.map((customer_id) => ({
    campaign_id: campaign.data.id,
    customer_id
  }));
  const ins = await sb.from("campaign_recipients").insert(recipients);
  if (ins.error) {
    // Don't leave a recipient-less shell behind.
    await sb.from("campaigns").delete().eq("id", campaign.data.id);
    return { ok: false, error: ins.error.message };
  }

  revalidatePath("/admin/campaigns");
  return { ok: true, value: { id: campaign.data.id } };
}

export async function launchCampaign(id: string): Promise<ActionResult> {
  await requireRole("admin");
  const sb = await createSupabaseServerClient();
  // Guarded transition: only a draft can launch, so double-clicks and stale
  // tabs can't re-launch a finished campaign.
  const { data, error } = await sb
    .from("campaigns")
    .update({ status: "sending", launched_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "draft")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Campaign is not a draft." };
  revalidatePath("/admin/campaigns");
  return { ok: true, value: undefined };
}

export async function deleteCampaign(id: string): Promise<ActionResult> {
  await requireRole("admin");
  const sb = await createSupabaseServerClient();
  // Drafts only — a launched campaign is an audit record, not clutter.
  const { data, error } = await sb
    .from("campaigns")
    .delete()
    .eq("id", id)
    .eq("status", "draft")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Only drafts can be deleted." };
  revalidatePath("/admin/campaigns");
  return { ok: true, value: undefined };
}
