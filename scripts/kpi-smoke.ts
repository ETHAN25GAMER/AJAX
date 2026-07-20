/**
 * Verify the KPI data layer against the live Supabase.
 * Run: npx tsx --env-file=.env.local scripts/kpi-smoke.ts
 */
import { supabase } from "@/lib/supabase/client";
import {
  rangeForKpi,
  computePriceBaseline,
  computeFinancialKpis,
  computeRevenueTrend,
  computeFunnel,
  computeAreaDistribution,
  computeTechnicianKpis
} from "@/lib/kpi/queries";

async function main() {
  const db = supabase();

  // Run every aggregation for the 30-day window.
  const range = rangeForKpi("month");
  const baseline = await computePriceBaseline(db as never);
  console.log("\nPrice baseline:", baseline);

  const [fin, trend, funnel, areas, techs] = await Promise.all([
    computeFinancialKpis(db as never, range, baseline),
    computeRevenueTrend(db as never, baseline),
    computeFunnel(db as never, range),
    computeAreaDistribution(db as never, range),
    computeTechnicianKpis(db as never, range, baseline)
  ]);

  console.log("\nFinancial:", { revenue: fin.revenue, completed: fin.completedCount, avgTicket: Math.round(fin.avgTicket) });
  console.log("Revenue trend:", trend.map((p) => `${p.label}:${p.value}${p.forecast ? "(f)" : ""}`).join("  "));
  console.log("Funnel:", funnel.map((s) => `${s.label}=${s.n}`).join("  "));
  console.log("Areas:", areas.length ? areas.map((a) => `${a.region}:${a.count}`).join("  ") : "(none)");
  console.log("Techs:", techs.map((t) => `${t.name}: ${t.completed} done, $${Math.round(t.revenue)}`).join(" | ") || "(none)");
  console.log("\n✓ all KPI aggregations executed without error.");
}

main().catch((e) => { console.error(e); process.exit(1); });
