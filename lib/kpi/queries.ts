import type { SupabaseClient } from "@supabase/supabase-js";
import { BUSINESS_TZ, parseBusinessTime } from "@/lib/time";
import { formatInTimeZone } from "date-fns-tz";
import type { ServiceTier } from "@/lib/supabase/types";

const TIER_LIST: ServiceTier[] = ["standard", "plus", "specialist"];

export type TierAverages = Record<ServiceTier, number>;

// Average non-zero base price per tier, from the pricing rate card. Used to
// *estimate* a job's value when `price_quoted` was never recorded (the booking
// tool doesn't write it today), so revenue figures aren't perpetually $0.
export async function computeTierAverages(sb: SupabaseClient): Promise<TierAverages> {
  const { data } = await sb.from("pricing").select("service_tier, base_price");
  const rows = (data ?? []) as Array<{ service_tier: ServiceTier; base_price: number | null }>;
  const acc: Record<ServiceTier, { sum: number; n: number }> = {
    standard: { sum: 0, n: 0 },
    plus: { sum: 0, n: 0 },
    specialist: { sum: 0, n: 0 }
  };
  for (const r of rows) {
    const b = r.base_price ?? 0;
    if (b > 0 && acc[r.service_tier]) {
      acc[r.service_tier].sum += b;
      acc[r.service_tier].n += 1;
    }
  }
  const out = {} as TierAverages;
  for (const t of TIER_LIST) out[t] = acc[t].n === 0 ? 0 : acc[t].sum / acc[t].n;
  return out;
}

// A job's value: the recorded quote if present, else the tier-average estimate.
export function valueOf(
  priceQuoted: number | null,
  tier: ServiceTier,
  tierAvgs: TierAverages
): number {
  return priceQuoted ?? tierAvgs[tier] ?? 0;
}

// All KPI helpers take a Singapore-local date range. Callers should construct
// `from`/`to` via `rangeForKpi()` so the cutoffs match the calendar buckets the
// rest of the app uses.

export type KpiRange = "week" | "month" | "quarter";

export type DateRange = { from: Date; to: Date; previousFrom: Date; previousTo: Date };

// Compute current and previous period boundaries in Singapore time.
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
  byTier: Record<ServiceTier, { revenue: number; count: number }>;
};

export async function computeFinancialKpis(
  sb: SupabaseClient,
  range: DateRange,
  tierAvgs: TierAverages
): Promise<FinancialKpis> {
  const [current, previous] = await Promise.all([
    sb
      .from("appointments")
      .select("price_quoted, service_tier")
      .eq("status", "completed")
      .gte("completed_at", range.from.toISOString())
      .lt("completed_at", range.to.toISOString()),
    sb
      .from("appointments")
      .select("price_quoted, service_tier")
      .eq("status", "completed")
      .gte("completed_at", range.previousFrom.toISOString())
      .lt("completed_at", range.previousTo.toISOString())
  ]);

  const rows = (current.data ?? []) as Array<{
    price_quoted: number | null;
    service_tier: ServiceTier;
  }>;
  const prevRows = (previous.data ?? []) as Array<{
    price_quoted: number | null;
    service_tier: ServiceTier;
  }>;

  const revenue = sumValue(rows, tierAvgs);
  const previousRevenue = sumValue(prevRows, tierAvgs);
  const completedCount = rows.length;
  const avgTicket = completedCount === 0 ? 0 : revenue / completedCount;

  const byTier: FinancialKpis["byTier"] = {
    standard: { revenue: 0, count: 0 },
    plus: { revenue: 0, count: 0 },
    specialist: { revenue: 0, count: 0 }
  };
  for (const r of rows) {
    const bucket = byTier[r.service_tier];
    bucket.count++;
    bucket.revenue += valueOf(r.price_quoted, r.service_tier, tierAvgs);
  }

  return { revenue, previousRevenue, completedCount, avgTicket, byTier };
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
  tierAvgs: TierAverages
): Promise<TechnicianKpi[]> {
  const [techs, appts] = await Promise.all([
    sb
      .from("profiles")
      .select("id, full_name, phone")
      .eq("role", "technician"),
    sb
      .from("appointments")
      .select(
        "id, assigned_technician_id, status, slot_start, slot_end, completed_at, customer_id, price_quoted, service_tier"
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
    service_tier: ServiceTier;
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
        (sum, a) => sum + valueOf(a.price_quoted, a.service_tier, tierAvgs),
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
  rows: Array<{ price_quoted: number | null; service_tier: ServiceTier }>,
  tierAvgs: TierAverages
): number {
  return rows.reduce((s, r) => s + valueOf(r.price_quoted, r.service_tier, tierAvgs), 0);
}

// ---------- Revenue trend (line chart) --------------------------------------

export type RevenuePoint = { label: string; value: number; forecast: boolean };

// Monthly est. revenue for the last `months` completed months, plus `forecast`
// projected months (last actual + average of the last 3 month-over-month deltas).
export async function computeRevenueTrend(
  sb: SupabaseClient,
  tierAvgs: TierAverages,
  opts: { months?: number; forecast?: number } = {}
): Promise<RevenuePoint[]> {
  const months = opts.months ?? 6;
  const forecast = opts.forecast ?? 2;

  const now = new Date();
  // First day of the month, `months - 1` months back, in Singapore time.
  const firstOfThisMonth = parseBusinessTime(
    `${formatInTimeZone(now, BUSINESS_TZ, "yyyy-MM")}-01T00:00:00`
  );
  const start = new Date(firstOfThisMonth);
  start.setMonth(start.getMonth() - (months - 1));

  const { data } = await sb
    .from("appointments")
    .select("price_quoted, service_tier, completed_at")
    .eq("status", "completed")
    .gte("completed_at", start.toISOString());

  const rows = (data ?? []) as Array<{
    price_quoted: number | null;
    service_tier: ServiceTier;
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
      totals.set(k, totals.get(k)! + valueOf(r.price_quoted, r.service_tier, tierAvgs));
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

// ---------- Busiest areas (SG postal region) --------------------------------

export type AreaCount = { region: string; count: number };

// Singapore postal sector (first 2 digits of a 6-digit code) → coarse region.
// Reference: URA/SingPost postal districts grouped into 5 regions.
const SECTOR_REGION: Record<string, string> = {};
(() => {
  const add = (region: string, sectors: number[]) =>
    sectors.forEach((s) => (SECTOR_REGION[String(s).padStart(2, "0")] = region));
  add("Central", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 38, 39, 40, 41, 58, 59]);
  add("East", [42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 81]);
  add("North-East", [53, 54, 55, 82, 56, 57]);
  add("North", [69, 70, 71, 72, 73, 75, 76, 77, 78, 79, 80]);
  add("West", [60, 61, 62, 63, 64, 65, 66, 67, 68, 17]);
})();

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

function regionFromAddress(address: string | null): string {
  if (!address) return "Unknown";
  const m = address.match(/\b(\d{6})\b/);
  if (!m) return "Unknown";
  const sector = m[1].slice(0, 2);
  return SECTOR_REGION[sector] ?? "Unknown";
}
