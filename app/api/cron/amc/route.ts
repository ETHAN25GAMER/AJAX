import { NextResponse } from "next/server";
import { formatInTimeZone } from "date-fns-tz";
import { supabase } from "@/lib/supabase/client";
import { sendTemplateToCustomer } from "@/lib/whatsapp/outbound";
import { TEMPLATES, TEMPLATE_LANG, textBody, firstName } from "@/lib/whatsapp/templates";
import { BUSINESS_TZ } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 60;

// Daily AMC cron: renewal reminders, follow-ups, and upsell pitches.
// Each pass is idempotent — re-running same day sends zero extra messages.

const FOLLOWUP_GAP_DAYS = 7;
const UPSELL_THROTTLE_DAYS = 90;
const UPSELL_BATCH_LIMIT = 50;

type AmcRow = {
  customer_id: string;
  renews_at: string;
  lead_days: number;
  pest_type: string;
  annual_price: number | null;
  reminder_sent_at: string | null;
  followup_sent_at: string | null;
  customers: { phone: string | null; name: string | null; opted_out: boolean | null } | null;
};

type UpsellCandidate = {
  id: string;
  phone: string | null;
  name: string | null;
  opted_out: boolean | null;
};

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (expected && auth !== expected) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const db = supabase();
  const now = new Date();

  const reminder = await runReminderPass(db, now);
  const followup = await runFollowupPass(db, now);
  const upsell = await runUpsellPass(db, now);

  return NextResponse.json({ reminder, followup, upsell });
}

async function runReminderPass(db: ReturnType<typeof supabase>, now: Date) {
  const candidates = await db
    .from("amc")
    .select(
      "customer_id, renews_at, lead_days, pest_type, annual_price, reminder_sent_at, followup_sent_at, customers(phone, name, opted_out)"
    )
    .eq("status", "active")
    .is("reminder_sent_at", null)
    .limit(200);

  if (candidates.error) return { error: candidates.error.message };

  const today = startOfBusinessDay(now);
  let sent = 0;
  let skipped = 0;

  for (const raw of (candidates.data ?? []) as unknown as AmcRow[]) {
    const customer = raw.customers;
    if (!customer?.phone) {
      skipped++;
      continue;
    }
    const renews = new Date(raw.renews_at + "T00:00:00Z");
    const windowOpens = new Date(renews.getTime() - raw.lead_days * 86_400_000);
    if (windowOpens > today) {
      skipped++;
      continue;
    }

    const ok = await fireTemplate(
      customer,
      TEMPLATES.amcRenewal,
      textBody(firstName(customer.name), raw.pest_type, friendlyDate(raw.renews_at)),
      "transactional",
      "amc renewal"
    );
    if (!ok) {
      skipped++;
      continue;
    }
    await db
      .from("amc")
      .update({ reminder_sent_at: now.toISOString() })
      .eq("customer_id", raw.customer_id);
    sent++;
  }

  return { checked: candidates.data?.length ?? 0, sent, skipped };
}

async function runFollowupPass(db: ReturnType<typeof supabase>, now: Date) {
  const cutoff = new Date(now.getTime() - FOLLOWUP_GAP_DAYS * 86_400_000);
  const todayStr = formatInTimeZone(now, BUSINESS_TZ, "yyyy-MM-dd");

  const candidates = await db
    .from("amc")
    .select(
      "customer_id, renews_at, lead_days, pest_type, annual_price, reminder_sent_at, followup_sent_at, customers(phone, name, opted_out)"
    )
    .eq("status", "active")
    .is("followup_sent_at", null)
    .not("reminder_sent_at", "is", null)
    .lt("reminder_sent_at", cutoff.toISOString())
    .gte("renews_at", todayStr)
    .limit(200);

  if (candidates.error) return { error: candidates.error.message };

  let sent = 0;
  let skipped = 0;

  for (const raw of (candidates.data ?? []) as unknown as AmcRow[]) {
    const customer = raw.customers;
    if (!customer?.phone) {
      skipped++;
      continue;
    }

    const ok = await fireTemplate(
      customer,
      TEMPLATES.amcRenewalFollowup,
      textBody(firstName(customer.name), raw.pest_type, friendlyDate(raw.renews_at)),
      "transactional",
      "amc followup"
    );
    if (!ok) {
      skipped++;
      continue;
    }
    await db
      .from("amc")
      .update({ followup_sent_at: now.toISOString() })
      .eq("customer_id", raw.customer_id);
    sent++;
  }

  return { checked: candidates.data?.length ?? 0, sent, skipped };
}

async function runUpsellPass(db: ReturnType<typeof supabase>, now: Date) {
  const throttleCutoff = new Date(now.getTime() - UPSELL_THROTTLE_DAYS * 86_400_000);

  // Customers with ≥1 completed appointment AND no AMC AND not pitched recently.
  // Two-step query because PostgREST doesn't compose NOT EXISTS cleanly.
  const completed = await db
    .from("appointments")
    .select("customer_id")
    .eq("status", "completed")
    .limit(1000);
  if (completed.error) return { error: completed.error.message };

  const completedIds = Array.from(new Set((completed.data ?? []).map((a) => a.customer_id)));
  if (completedIds.length === 0) return { checked: 0, sent: 0, skipped: 0 };

  const amcRows = await db.from("amc").select("customer_id").in("customer_id", completedIds);
  if (amcRows.error) return { error: amcRows.error.message };
  const amcSet = new Set((amcRows.data ?? []).map((r) => r.customer_id));
  const eligibleIds = completedIds.filter((id) => !amcSet.has(id));
  if (eligibleIds.length === 0) return { checked: 0, sent: 0, skipped: 0 };

  const candidates = await db
    .from("customers")
    .select("id, phone, name, opted_out, amc_pitched_at")
    .in("id", eligibleIds)
    .or(`amc_pitched_at.is.null,amc_pitched_at.lt.${throttleCutoff.toISOString()}`)
    .eq("opted_out", false)
    .limit(UPSELL_BATCH_LIMIT);
  if (candidates.error) return { error: candidates.error.message };

  let sent = 0;
  let skipped = 0;

  for (const c of (candidates.data ?? []) as UpsellCandidate[]) {
    if (!c.phone) {
      skipped++;
      continue;
    }
    const ok = await fireTemplate(
      { phone: c.phone, opted_out: c.opted_out, name: c.name },
      TEMPLATES.amcUpsell,
      textBody(firstName(c.name), "general pest", "annual"),
      "promotional",
      "amc upsell"
    );
    if (!ok) {
      skipped++;
      continue;
    }
    await db
      .from("customers")
      .update({ amc_pitched_at: now.toISOString() })
      .eq("id", c.id);
    sent++;
  }

  return { checked: candidates.data?.length ?? 0, sent, skipped };
}

async function fireTemplate(
  customer: { phone: string | null; opted_out: boolean | null; name?: string | null },
  templateName: string,
  components: ReturnType<typeof textBody>,
  kind: "transactional" | "promotional",
  logLabel: string
): Promise<boolean> {
  if (!customer.phone) return false;
  try {
    const result = await sendTemplateToCustomer(
      { phone: customer.phone, opted_out: customer.opted_out },
      templateName,
      TEMPLATE_LANG,
      components,
      { kind }
    );
    return result.ok;
  } catch (err) {
    console.error(`[amc cron] ${logLabel} send failed`, customer.phone, err);
    return false;
  }
}

function startOfBusinessDay(now: Date): Date {
  const todayStr = formatInTimeZone(now, BUSINESS_TZ, "yyyy-MM-dd");
  return new Date(todayStr + "T00:00:00Z");
}

function friendlyDate(dateStr: string): string {
  return formatInTimeZone(new Date(dateStr + "T00:00:00Z"), BUSINESS_TZ, "d MMM yyyy");
}
