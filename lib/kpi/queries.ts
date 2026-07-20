import type { SupabaseClient } from "@supabase/supabase-js";
import { BUSINESS_TZ, parseBusinessTime } from "@/lib/time";
import { formatInTimeZone } from "date-fns-tz";

// Average non-zero base price across the (flat, one-row-per-pest) rate card.
// Used to *estimate* a job's value when `price_quoted` was never recorded (the
// booking tool doesn't write it today), so revenue figures aren't perpetually $0.
export async function computePriceBaseline(sb: SupabaseClient): Promise<number> {
  const { data } = await sb.from("pricing").select("base_price");
  const prices = ((data ?? []) as Array<{ base_price: number | null }>)
    .map((r) => r.base_price ?? 0)
    .filter((b) => b > 0);
  if (prices.length === 0) return 0;
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}

// A job's value: the recorded quote if present, else the rate-card baseline.
export function valueOf(priceQuoted: number | null, baseline: number): number {
  return priceQuoted ?? baseline ?? 0;
}

// All KPI helpers take an IST-local date range. Callers should construct
// `from`/`to` via `rangeForKpi()` so the cutoffs match the calendar buckets the
// rest of the app uses.

export type KpiRange = "week" | "month" | "quarter";

export type DateRange = { from: Date; to: Date; previousFrom: Date; previousTo: Date };

// Compute current and previous period boundaries in IST.
export function rangeForKpi(range: KpiRange, now = new Date()): DateRange {
  const today = formatInTimeZone(now, BUSINESS_TZ, "yyyy-MM-dd");
  const todayMidnight = parseBusinessTime(`${today}T00:00:00`);
  const dayMs = 86_400_000;

  let lengthDays: number;
  switch (range) {
    case "week":
      lengthDays = 7;
      break;
    case "month":
      lengthDays = 30;
      break;
    case "quarter":
      lengthDays = 90;
      break;
  }

  const to = new Date(todayMidnight.getTime() + dayMs); // include today
  const from = new Date(to.getTime() - lengthDays * dayMs);
  const previousTo = from;
  const previousFrom = new Date(previousTo.getTime() - lengthDays * dayMs);
  return { from, to, previousFrom, previousTo };
}

// ---------- Financial -------------------------------------------------------

export type FinancialKpis = {
  revenue: number;
  previousRevenue: number;
  completedCount: number;
  avgTicket: number;
  // Top pests by estimated revenue in the range (flat service — the old
  // by-tier split went away with service tiers in migration 0020).
  byPest: Array<{ pest: string; revenue: number; count: number }>;
};

export async function computeFinancialKpis(
  sb: SupabaseClient,
  range: DateRange,
  baseline: number
): Promise<FinancialKpis> {
  const [current, previous] = await Promise.all([
    sb
      .from("appointments")
      .select("price_quoted, pest_type")
      .eq("status", "completed")
      .gte("completed_at", range.from.toISOString())
      .lt("completed_at", range.to.toISOString()),
    sb
      .from("appointments")
      .select("price_quoted")
      .eq("status", "completed")
      .gte("completed_at", range.previousFrom.toISOString())
      .lt("completed_at", range.previousTo.toISOString())
  ]);

  const rows = (current.data ?? []) as Array<{
    price_quoted: number | null;
    pest_type: string;
  }>;
  const prevRows = (previous.data ?? []) as Array<{ price_quoted: number | null }>;

  const revenue = sumValue(rows, baseline);
  const previousRevenue = sumValue(prevRows, baseline);
  const completedCount = rows.length;
  const avgTicket = completedCount === 0 ? 0 : revenue / completedCount;

  const pestBuckets = new Map<string, { revenue: number; count: number }>();
  for (const r of rows) {
    const key = r.pest_type || "unknown";
    const bucket = pestBuckets.get(key) ?? { revenue: 0, count: 0 };
    bucket.count++;
    bucket.revenue += valueOf(r.price_quoted, baseline);
    pestBuckets.set(key, bucket);
  }
  const byPest = Array.from(pestBuckets.entries())
    .map(([pest, v]) => ({ pest, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  return { revenue, previousRevenue, completedCount, avgTicket, byPest };
}

// ---------- AMC -------------------------------------------------------------

export type AmcKpis = {
  activeCount: number;
  annualRecurringRevenue: number;
  renewalsDueIn30Days: number;
  churnedInRange: number;
};

export async function computeAmcKpis(
  sb: SupabaseClient,
  range: DateRange
): Promise<AmcKpis> {
  const horizon = new Date(Date.now() + 30 * 86_400_000);

  const [active, due, churned] = await Promise.all([
    sb
      .from("amc")
      .select("annual_price")
      .eq("status", "active"),
    sb
      .from("amc")
      .select("customer_id", { count: "exact", head: true })
      .eq("status", "active")
      .lte("renews_at", horizon.toISOString().slice(0, 10)),
    sb
      .from("amc")
      .select("customer_id", { count: "exact", head: true })
      .in("status", ["cancelled", "expired"])
      .gte("renews_at", range.from.toISOString().slice(0, 10))
      .lt("renews_at", range.to.toISOString().slice(0, 10))
  ]);

  const activeRows = (active.data ?? []) as Array<{ annual_price: number | null }>;

  return {
    activeCount: activeRows.length,
    annualRecurringRevenue: activeRows.reduce((s, r) => s + (r.annual_price ?? 0), 0),
    renewalsDueIn30Days: due.count ?? 0,
    churnedInRange: churned.count ?? 0
  };
}

// ---------- Technicians -----------------------------------------------------

export type TechnicianKpi = {
  id: string;
  name: string;
  completed: number;
  booked: number;
  cancelled: number;
  completionRate: number; // 0..1, completed / (completed + cancelled + booked-past-slot)
  avgJobMinutes: number | null;
  escalations: number;
  photoCompliance: number; // 0..1
  revenue: number; // est. value of completed jobs in range
};

export async function computeTechnicianKpis(
  sb: SupabaseClient,
  range: DateRange,
  baseline: number
): Promise<TechnicianKpi[]> {
  const [techs, appts] = await Promise.all([
    sb
      .from("profiles")
      .select("id, full_name, phone")
      .eq("role", "technician"),
    sb
      .from("appointments")
      .select(
        "id, assigned_technician_id, status, slot_start, slot_end, completed_at, customer_id, price_quoted"
      )
      .gte("slot_start", range.from.toISOString())
      .lt("slot_start", range.to.toISOString())
      .not("assigned_technician_id", "is", null)
  ]);

  const techRows = (techs.data ?? []) as Array<{
    id: string;
    full_name: string | null;
    phone: string | null;
  }>;
  const apptRows = (appts.data ?? []) as Array<{
    id: string;
    assigned_technician_id: string;
    status: "booked" | "completed" | "cancelled";
    slot_start: string;
    slot_end: string;
    completed_at: string | null;
    customer_id: string;
    price_quoted: number | null;
  }>;

  // Photo + escalation lookups are cheaper as a single batch each.
  const completedIds = apptRows.filter((a) => a.status === "completed").map((a) => a.id);
  const customerIds = Array.from(new Set(apptRows.map((a) => a.customer_id)));

  const [photoRes, escRes] = await Promise.all([
    completedIds.length > 0
      ? sb
          .from("appointment_photos")
          .select("appointment_id")
          .in("appointment_id", completedIds)
      : Promise.resolve({ data: [] as Array<{ appointment_id: string }> }),
    customerIds.length > 0
      ? sb
          .from("escalations")
          .select("customer_id")
          .in("customer_id", customerIds)
          .gte("created_at", range.from.toISOString())
          .lt("created_at", range.to.toISOString())
      : Promise.resolve({ data: [] as Array<{ customer_id: string }> })
  ]);

  const photosByAppt = new Set(
    ((photoRes.data ?? []) as Array<{ appointment_id: string }>).map((p) => p.appointment_id)
  );
  const escByCustomer = new Map<string, number>();
  for (const e of (escRes.data ?? []) as Array<{ customer_id: string }>) {
    escByCustomer.set(e.customer_id, (escByCustomer.get(e.customer_id) ?? 0) + 1);
  }

  return techRows
    .map((t) => {
      const own = apptRows.filter((a) => a.assigned_technician_id === t.id);
      const completed = own.filter((a) => a.status === "completed");
      const cancelled = own.filter((a) => a.status === "cancelled");
      const booked = own.filter((a) => a.status === "booked");
      const total = own.length;

      // Average job duration: slot_start → completed_at, completed only.
      const durations = completed
        .filter((a) => a.completed_at)
        .map((a) => (new Date(a.completed_at!).getTime() - new Date(a.slot_start).getTime()) / 60_000)
        .filter((m) => m > 0 && m < 60 * 12); // drop nonsense outliers (>12h)
      const avgJobMinutes =
        durations.length === 0
          ? null
          : Math.round(durations.reduce((s, m) => s + m, 0) / durations.length);

      const escalations = own.reduce(
        (sum, a) => sum + (escByCustomer.get(a.customer_id) ?? 0),
        0
      );
      const completedWithPhoto = completed.filter((a) => photosByAppt.has(a.id)).length;
      const photoCompliance =
        completed.length === 0 ? 1 : completedWithPhoto / completed.length;

      const revenue = completed.reduce(
        (sum, a) => sum + valueOf(a.price_quoted, baseline),
        0
      );

      return {
        id: t.id,
        name: (t.full_name?.trim() || t.phone || t.id.slice(0, 8)) as string,
        completed: completed.length,
        booked: booked.length,
        cancelled: cancelled.length,
        completionRate: total === 0 ? 0 : completed.length / total,
        avgJobMinutes,
        escalations,
        photoCompliance,
        revenue
      } satisfies TechnicianKpi;
    })
    .sort((a, b) => b.completed - a.completed);
}

// ---------- Operational -----------------------------------------------------

export type OperationalKpis = {
  escalationsOpened: number;
  escalationsResolved: number;
  highUrgency: number;
  cancellationRate: number;
  noShowCount: number;
};

export async function computeOperationalKpis(
  sb: SupabaseClient,
  range: DateRange
): Promise<OperationalKpis> {
  const now = new Date();
  const [esc, escResolved, escHigh, appts, noShow] = await Promise.all([
    sb
      .from("escalations")
      .select("id", { count: "exact", head: true })
      .gte("created_at", range.from.toISOString())
      .lt("created_at", range.to.toISOString()),
    sb
      .from("escalations")
      .select("id", { count: "exact", head: true })
      .eq("resolved", true)
      .gte("created_at", range.from.toISOString())
      .lt("created_at", range.to.toISOString()),
    sb
      .from("escalations")
      .select("id", { count: "exact", head: true })
      .eq("urgency", "high")
      .gte("created_at", range.from.toISOString())
      .lt("created_at", range.to.toISOString()),
    sb
      .from("appointments")
      .select("status")
      .gte("slot_start", range.from.toISOString())
      .lt("slot_start", range.to.toISOString()),
    sb
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("status", "booked")
      .lt("slot_end", now.toISOString())
      .gte("slot_start", range.from.toISOString())
      .lt("slot_start", range.to.toISOString())
  ]);

  const apptRows = (appts.data ?? []) as Array<{ status: "booked" | "completed" | "cancelled" }>;
  const cancelled = apptRows.filter((a) => a.status === "cancelled").length;
  const cancellationRate = apptRows.length === 0 ? 0 : cancelled / apptRows.length;

  return {
    escalationsOpened: esc.count ?? 0,
    escalationsResolved: escResolved.count ?? 0,
    highUrgency: escHigh.count ?? 0,
    cancellationRate,
    noShowCount: noShow.count ?? 0
  };
}

function sumValue(
  rows: Array<{ price_quoted: number | null }>,
  baseline: number
): number {
  return rows.reduce((s, r) => s + valueOf(r.price_quoted, baseline), 0);
}

// ---------- Revenue trend (line chart) --------------------------------------

export type RevenuePoint = { label: string; value: number; forecast: boolean };

// Monthly est. revenue for the last `months` completed months, plus `forecast`
// projected months (last actual + average of the last 3 month-over-month deltas).
export async function computeRevenueTrend(
  sb: SupabaseClient,
  baseline: number,
  opts: { months?: number; forecast?: number } = {}
): Promise<RevenuePoint[]> {
  const months = opts.months ?? 6;
  const forecast = opts.forecast ?? 2;

  const now = new Date();
  // First day of the month, `months - 1` months back, in IST.
  const firstOfThisMonth = parseBusinessTime(
    `${formatInTimeZone(now, BUSINESS_TZ, "yyyy-MM")}-01T00:00:00`
  );
  const start = new Date(firstOfThisMonth);
  start.setMonth(start.getMonth() - (months - 1));

  const { data } = await sb
    .from("appointments")
    .select("price_quoted, completed_at")
    .eq("status", "completed")
    .gte("completed_at", start.toISOString());

  const rows = (data ?? []) as Array<{
    price_quoted: number | null;
    completed_at: string | null;
  }>;

  // Build the ordered list of month keys we expect, seeded at 0.
  const keys: string[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + i);
    keys.push(formatInTimeZone(d, BUSINESS_TZ, "yyyy-MM"));
  }
  const totals = new Map<string, number>(keys.map((k) => [k, 0]));

  for (const r of rows) {
    if (!r.completed_at) continue;
    const k = formatInTimeZone(new Date(r.completed_at), BUSINESS_TZ, "yyyy-MM");
    if (totals.has(k)) {
      totals.set(k, totals.get(k)! + valueOf(r.price_quoted, baseline));
    }
  }

  const actual: RevenuePoint[] = keys.map((k) => ({
    label: formatInTimeZone(parseBusinessTime(`${k}-01T00:00:00`), BUSINESS_TZ, "MMM"),
    value: Math.round(totals.get(k) ?? 0),
    forecast: false
  }));

  // Projection: average of the last up-to-3 month-over-month deltas.
  const vals = actual.map((p) => p.value);
  const deltas: number[] = [];
  for (let i = Math.max(1, vals.length - 3); i < vals.length; i++) {
    deltas.push(vals[i] - vals[i - 1]);
  }
  const avgDelta = deltas.length ? deltas.reduce((s, d) => s + d, 0) / deltas.length : 0;

  const out = [...actual];
  let last = vals[vals.length - 1] ?? 0;
  let cursor = new Date(start);
  cursor.setMonth(cursor.getMonth() + months - 1);
  for (let i = 0; i < forecast; i++) {
    cursor = new Date(cursor);
    cursor.setMonth(cursor.getMonth() + 1);
    last = Math.max(0, Math.round(last + avgDelta));
    out.push({
      label: formatInTimeZone(cursor, BUSINESS_TZ, "MMM"),
      value: last,
      forecast: true
    });
  }
  return out;
}

// ---------- Lead → booking funnel -------------------------------------------

export type FunnelStage = { label: string; n: number; pct: number };

export async function computeFunnel(sb: SupabaseClient, range: DateRange): Promise<FunnelStage[]> {
  const [leads, booked, completed, cancelled] = await Promise.all([
    sb
      .from("customers")
      .select("id", { count: "exact", head: true })
      .gte("created_at", range.from.toISOString())
      .lt("created_at", range.to.toISOString()),
    sb
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .gte("created_at", range.from.toISOString())
      .lt("created_at", range.to.toISOString()),
    sb
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .gte("completed_at", range.from.toISOString())
      .lt("completed_at", range.to.toISOString()),
    sb
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("status", "cancelled")
      .gte("slot_start", range.from.toISOString())
      .lt("slot_start", range.to.toISOString())
  ]);

  const stages = [
    { label: "Leads", n: leads.count ?? 0 },
    { label: "Booked", n: booked.count ?? 0 },
    { label: "Completed", n: completed.count ?? 0 },
    { label: "Cancelled", n: cancelled.count ?? 0 }
  ];
  const top = Math.max(stages[0].n, 1);
  return stages.map((s) => ({ ...s, pct: Math.min(100, (s.n / top) * 100) }));
}

// ---------- Busiest areas (Indian PIN code) ----------------------------------

export type AreaCount = { region: string; count: number };

export async function computeAreaDistribution(
  sb: SupabaseClient,
  range: DateRange
): Promise<AreaCount[]> {
  const { data } = await sb
    .from("appointments")
    .select("id, customers(address)")
    .gte("slot_start", range.from.toISOString())
    .lt("slot_start", range.to.toISOString());

  // PostgREST embeds the joined relation as an array; normalise to one row.
  const rows = (data ?? []) as unknown as Array<{
    customers: { address: string | null } | Array<{ address: string | null }> | null;
  }>;
  const counts = new Map<string, number>();
  for (const r of rows) {
    const c = Array.isArray(r.customers) ? r.customers[0] : r.customers;
    const region = regionFromAddress(c?.address ?? null);
    counts.set(region, (counts.get(region) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count);
}

// Bucket by the PIN's first 3 digits (the India Post sorting district — a
// coherent local area within a city, e.g. all of 400xxx is Mumbai). Works in
// any Indian city without a hardcoded map; the heatmap shows the districts the
// business actually serves.
function regionFromAddress(address: string | null): string {
  if (!address) return "Unknown";
  const m = address.match(/\b([1-9]\d{5})\b/);
  if (!m) return "Unknown";
  return `PIN ${m[1].slice(0, 3)}xxx`;
}

// --- Feedback (post-visit CSAT) ---------------------------------------------

export type FeedbackKpis = {
  responses: number;
  avgRating: number | null;
  previousAvg: number | null;
  promoters: number; // rated 4-5
  detractors: number; // rated 1-2
  latestComments: Array<{ rating: number; comment: string; created_at: string }>;
};

export async function computeFeedbackKpis(
  sb: SupabaseClient,
  range: DateRange
): Promise<FeedbackKpis> {
  const [current, previous] = await Promise.all([
    sb
      .from("feedback")
      .select("rating, comment, created_at")
      .gte("created_at", range.from.toISOString())
      .lt("created_at", range.to.toISOString())
      .order("created_at", { ascending: false }),
    sb
      .from("feedback")
      .select("rating")
      .gte("created_at", range.previousFrom.toISOString())
      .lt("created_at", range.previousTo.toISOString())
  ]);

  const rows = (current.data ?? []) as Array<{
    rating: number;
    comment: string | null;
    created_at: string;
  }>;
  const prevRows = (previous.data ?? []) as Array<{ rating: number }>;

  const avg = (xs: number[]) =>
    xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

  return {
    responses: rows.length,
    avgRating: avg(rows.map((r) => r.rating)),
    previousAvg: avg(prevRows.map((r) => r.rating)),
    promoters: rows.filter((r) => r.rating >= 4).length,
    detractors: rows.filter((r) => r.rating <= 2).length,
    latestComments: rows
      .filter((r) => r.comment && r.comment.trim() !== "")
      .slice(0, 3)
      .map((r) => ({ rating: r.rating, comment: r.comment!.trim(), created_at: r.created_at }))
  };
}

// --- Lead sources (click-to-WhatsApp ad attribution) -------------------------

export type LeadSource = { source: string; count: number };

// New customers in range, grouped by first-touch acquisition. Customers with no
// stamped referral are "organic" (they messaged the number directly).
export async function computeLeadSources(
  sb: SupabaseClient,
  range: DateRange
): Promise<LeadSource[]> {
  const { data } = await sb
    .from("customers")
    .select("acquisition")
    .gte("created_at", range.from.toISOString())
    .lt("created_at", range.to.toISOString());

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ acquisition: { source_type?: string | null; headline?: string | null } | null }>) {
    const a = row.acquisition;
    const source = a ? `${a.source_type ?? "ad"}${a.headline ? ` · ${a.headline}` : ""}` : "organic";
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
}

// --- SLA / responsiveness ----------------------------------------------------

export type SlaEvent = {
  conversation_id: string;
  direction: "inbound" | "outbound_agent" | "outbound_staff";
  at: string;
};

export type SlaKpis = {
  inboundCount: number;
  agentReplies: number;
  staffReplies: number;
  /** Median first-reply latency in ms, null when no pairs exist. */
  medianReplyMs: number | null;
  /** 90th-percentile first-reply latency in ms. */
  p90ReplyMs: number | null;
  /** Share of outbound replies sent by a human (0..1), null when no outbound. */
  staffShare: number | null;
};

// Pure: pair each inbound with the NEXT outbound in the same conversation and
// return the latencies. Consecutive inbounds before one reply collapse to the
// first (the customer double-texted; the wait started at their first message).
// Exported for direct testing.
export function pairFirstReplies(events: SlaEvent[]): number[] {
  const byConvo = new Map<string, SlaEvent[]>();
  for (const e of events) {
    const list = byConvo.get(e.conversation_id) ?? [];
    list.push(e);
    byConvo.set(e.conversation_id, list);
  }

  const latencies: number[] = [];
  for (const list of byConvo.values()) {
    list.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    let pendingInboundAt: number | null = null;
    for (const e of list) {
      if (e.direction === "inbound") {
        if (pendingInboundAt === null) pendingInboundAt = new Date(e.at).getTime();
      } else if (pendingInboundAt !== null) {
        latencies.push(new Date(e.at).getTime() - pendingInboundAt);
        pendingInboundAt = null;
      }
    }
  }
  return latencies;
}

export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.ceil((p / 100) * sortedAsc.length) - 1);
  return sortedAsc[Math.max(0, idx)];
}

export async function computeSlaKpis(sb: SupabaseClient, range: DateRange): Promise<SlaKpis> {
  const { data } = await sb
    .from("message_events")
    .select("conversation_id, direction, at")
    .gte("at", range.from.toISOString())
    .lt("at", range.to.toISOString())
    .order("at", { ascending: true })
    .limit(10_000);

  const events = (data ?? []) as SlaEvent[];
  const inboundCount = events.filter((e) => e.direction === "inbound").length;
  const agentReplies = events.filter((e) => e.direction === "outbound_agent").length;
  const staffReplies = events.filter((e) => e.direction === "outbound_staff").length;
  const outbound = agentReplies + staffReplies;

  const latencies = pairFirstReplies(events).sort((a, b) => a - b);

  return {
    inboundCount,
    agentReplies,
    staffReplies,
    medianReplyMs: percentile(latencies, 50),
    p90ReplyMs: percentile(latencies, 90),
    staffShare: outbound === 0 ? null : staffReplies / outbound
  };
}
