import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { TEMPLATES } from "@/lib/whatsapp/templates";
import type { Campaign, CampaignRecipientStatus } from "@/lib/supabase/types";
import { CampaignsClient, type CampaignWithCounts } from "./campaigns-client";

export const metadata = { title: "Campaigns" };
export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <div className="surface-paper min-h-dvh px-6 py-16 md:px-12">
        <div className="mx-auto max-w-2xl border border-destructive/40 bg-card px-6 py-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-destructive">
            Database error
          </p>
          <p className="mt-2 text-sm text-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  const campaigns = (data ?? []) as Campaign[];

  // Per-campaign status counts, derived from recipients so they can't drift.
  // One fetch for all listed campaigns; grouped in memory (list is ≤100 rows).
  const counts = new Map<string, Record<CampaignRecipientStatus, number>>();
  if (campaigns.length > 0) {
    const { data: recipientRows } = await supabase
      .from("campaign_recipients")
      .select("campaign_id, status")
      .in(
        "campaign_id",
        campaigns.map((c) => c.id)
      );
    for (const r of (recipientRows ?? []) as Array<{
      campaign_id: string;
      status: CampaignRecipientStatus;
    }>) {
      const entry =
        counts.get(r.campaign_id) ?? { queued: 0, sent: 0, skipped: 0, failed: 0 };
      entry[r.status]++;
      counts.set(r.campaign_id, entry);
    }
  }

  const withCounts: CampaignWithCounts[] = campaigns.map((c) => ({
    ...c,
    template_params: Array.isArray(c.template_params) ? c.template_params : [],
    counts: counts.get(c.id) ?? { queued: 0, sent: 0, skipped: 0, failed: 0 }
  }));

  // Approved template names for the compose dropdown. Only the upsell template
  // is promotional-shaped today; clients approve their own campaign templates
  // and pick "custom" to use them.
  const templateOptions = [TEMPLATES.amcUpsell];

  return <CampaignsClient initial={withCounts} templateOptions={templateOptions} />;
}
