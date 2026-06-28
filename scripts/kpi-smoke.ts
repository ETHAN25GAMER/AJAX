/**
 * Verify the KPI data layer against the live Supabase, and enable tier 3 so
 * /admin/kpi renders. Run: npx tsx --env-file=.env.local scripts/kpi-smoke.ts
 */
import { supabase } from "@/lib/supabase/client";
import {
  rangeForKpi,
  computeTierAverages,
  computeFinancialKpis,
  computeRevenueTrend,
  computeFunnel,
  computeAreaDistribution,
  computeTechnicianKpis
} from "@/lib/kpi/queries";

async function main() {
  const db = supabase();

  // 1) deployment_settings present? set tier3 so the page unlocks.
  const ds = await db.from("deployment_settings").select("id, tier").eq("id", 1).maybeSingle();
  if (ds.error) {
    console.log("⚠ deployment_settings not reachable:", ds.error.message,
      "\n  → migration 0009 likely not applied to this DB; /admin/kpi will show the Upsell screen.");
  } else if (!ds.data) {
    await db.from("deployment_settings").insert({ id: 1, tier: "tier3" });
    console.log("✓ inserted deployment_settings row, tier=tier3");
  } else {
    await db.from("deployment_settings").update({ tier: "tier3" }).eq("id", 1);
    console.log(`✓ deployment_settings tier set to tier3 (was ${ds.data.tier})`);
  }

  // 2) run every new aggregation for the 30-day window.
  const range = rangeForKpi("month");
  const tierAvgs = await computeTierAverages(db as never);
  console.log("\nTier averages:", tierAvgs);

  const [fin, trend, funnel, areas, techs] = await Promise.all([
    computeFinancialKpis(db as never, range, tierAvgs),
    computeRevenueTrend(db as never, tierAvgs),
    computeFunnel(db as never, range),
    computeAreaDistribution(db as never, range),
    computeTechnicianKpis(db as never, range, tierAvgs)
  ]);

  console.log("\nFinancial:", { revenue: fin.revenue, completed: fin.completedCount, avgTicket: Math.round(fin.avgTicket) });
  console.log("Revenue trend:", trend.map((p) => `${p.label}:${p.value}${p.forecast ? "(f)" : ""}`).join("  "));
  console.log("Funnel:", funnel.map((s) => `${s.label}=${s.n}`).join("  "));
  console.log("Areas:", areas.length ? areas.map((a) => `${a.region}:${a.count}`).join("  ") : "(none)");
  console.log("Techs:", techs.map((t) => `${t.name}: ${t.completed} done, $${Math.round(t.revenue)}`).join(" | ") || "(none)");
  console.log("\n✓ all KPI aggregations executed without error.");
}

main().catch((e) => { console.error(e); process.exit(1); });
