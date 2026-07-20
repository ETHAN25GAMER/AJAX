import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { sendTemplateToCustomer } from "@/lib/whatsapp/outbound";
import { TEMPLATE_LANG, firstName, textBody } from "@/lib/whatsapp/templates";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

// Campaign dispatch: drains queued recipients of 'sending' campaigns in
// batches. A campaign with thousands of recipients can't send inside one
// request's time budget, so each cron pass takes a bite; when a campaign has
// no queued recipients left it flips to 'done'. Re-running is idempotent —
// every send transitions its recipient row out of 'queued' first.

const CAMPAIGN_LIMIT = 3;    // campaigns advanced per pass
const BATCH_LIMIT = 50;      // recipients per campaign per pass

type CampaignRow = {
  id: string;
  template_name: string;
  template_params: unknown;
};

type RecipientRow = {
  campaign_id: string;
  customer_id: string;
  customers: { phone: string | null; name: string | null; opted_out: boolean | null } | null;
};

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const db = supabase();
  const now = new Date();

  const campaigns = await db
    .from("campaigns")
    .select("id, template_name, template_params")
    .eq("status", "sending")
    .order("launched_at", { ascending: true })
    .limit(CAMPAIGN_LIMIT);
  if (campaigns.error) {
    return NextResponse.json({ error: campaigns.error.message }, { status: 500 });
  }

  const results: Record<string, { sent: number; skipped: number; failed: number; done: boolean }> = {};

  for (const campaign of (campaigns.data ?? []) as CampaignRow[]) {
    results[campaign.id] = await drainCampaign(db, campaign, now);
  }

  return NextResponse.json({ campaigns: results });
}

async function drainCampaign(
  db: ReturnType<typeof supabase>,
  campaign: CampaignRow,
  now: Date
): Promise<{ sent: number; skipped: number; failed: number; done: boolean }> {
  const params = Array.isArray(campaign.template_params)
    ? (campaign.template_params as string[])
    : [];

  const batch = await db
    .from("campaign_recipients")
    .select("campaign_id, customer_id, customers(phone, name, opted_out)")
    .eq("campaign_id", campaign.id)
    .eq("status", "queued")
    .limit(BATCH_LIMIT);
  if (batch.error) {
    console.error("[campaign-dispatch] batch fetch failed", campaign.id, batch.error.message);
    return { sent: 0, skipped: 0, failed: 0, done: false };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // Supabase types embedded relations as arrays; customer_id FKs one customer.
  for (const row of (batch.data ?? []) as unknown as RecipientRow[]) {
    const customer = row.customers;
    const mark = (status: "sent" | "skipped" | "failed", detail: string | null) =>
      db
        .from("campaign_recipients")
        .update({ status, detail, sent_at: status === "sent" ? now.toISOString() : null })
        .eq("campaign_id", row.campaign_id)
        .eq("customer_id", row.customer_id);

    if (!customer?.phone) {
      await mark("skipped", "no phone");
      skipped++;
      continue;
    }

    // {name} in a stored param personalizes to the recipient's first name.
    const filled = params.map((p) => p.replaceAll("{name}", firstName(customer.name)));

    try {
      const gate = await sendTemplateToCustomer(
        { phone: customer.phone, opted_out: customer.opted_out },
        campaign.template_name,
        TEMPLATE_LANG,
        textBody(...filled),
        { kind: "promotional" }
      );
      if (gate.ok) {
        await mark("sent", null);
        sent++;
      } else {
        await mark("skipped", gate.reason);
        skipped++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[campaign-dispatch] send failed", campaign.id, customer.phone, message);
      await mark("failed", message.slice(0, 500));
      failed++;
    }
  }

  // Anything still queued? If not, the campaign is finished.
  const remaining = await db
    .from("campaign_recipients")
    .select("customer_id", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .eq("status", "queued");

  const done = !remaining.error && (remaining.count ?? 0) === 0;
  if (done) {
    await db
      .from("campaigns")
      .update({ status: "done", completed_at: now.toISOString() })
      .eq("id", campaign.id)
      .eq("status", "sending");
  }

  return { sent, skipped, failed, done };
}
