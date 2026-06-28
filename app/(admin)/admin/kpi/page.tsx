import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { getDeploymentTier } from "@/lib/tier";
import { cn } from "@/lib/utils";
import {
  computeAmcKpis,
  computeAreaDistribution,
  computeFinancialKpis,
  computeFunnel,
  computeOperationalKpis,
  computeRevenueTrend,
  computeTechnicianKpis,
  computeTierAverages,
  rangeForKpi,
  type KpiRange
} from "@/lib/kpi/queries";
import { Upsell } from "./upsell";
import { FinancialSection } from "./sections/financial";
import { RevenueTrendSection } from "./sections/revenue-trend";
import { FunnelSection } from "./sections/funnel";
import { AreasSection } from "./sections/areas";
import { AmcSection } from "./sections/amc";
import { TechniciansSection } from "./sections/technicians";
import { TechRevenueSection } from "./sections/tech-revenue";
import { OperationalSection } from "./sections/operational";

export const metadata = { title: "KPI — PestLLM" };
export const dynamic = "force-dynamic";

const RANGES: { id: KpiRange; label: string; days: number }[] = [
  { id: "week", label: "7 days", days: 7 },
  { id: "month", label: "30 days", days: 30 },
  { id: "quarter", label: "90 days", days: 90 }
];

export default async function KpiPage({
  searchParams
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  await requireRole("admin");
  const tier = await getDeploymentTier();
  if (tier !== "tier3") return <Upsell />;

  const params = await searchParams;
  const range = (RANGES.find((r) => r.id === params.range)?.id ?? "month") as KpiRange;
  const dateRange = rangeForKpi(range);

  const sb = await createSupabaseServerClient();
  const tierAvgs = await computeTierAverages(sb);
  const [financial, revenueTrend, funnel, areas, amc, technicians, operational] =
    await Promise.all([
      computeFinancialKpis(sb, dateRange, tierAvgs),
      computeRevenueTrend(sb, tierAvgs),
      computeFunnel(sb, dateRange),
      computeAreaDistribution(sb, dateRange),
      computeAmcKpis(sb, dateRange),
      computeTechnicianKpis(sb, dateRange, tierAvgs),
      computeOperationalKpis(sb, dateRange)
    ]);

  return (
    <div className="surface-paper min-h-dvh">
      <div className="mx-auto max-w-6xl px-5 py-10 md:px-10 md:py-14">
        <header className="flex items-end justify-between gap-6">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Tier 3 · Performance
            </p>
            <h1 className="mt-3 font-serif text-[44px] leading-[1.02] tracking-tight text-ink md:text-[56px]">
              KPI.
            </h1>
            <p className="mt-3 text-base text-muted-foreground">
              Compared against the previous {RANGES.find((r) => r.id === range)!.days}-day window.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Range"
            className="flex shrink-0 gap-1.5 border-b border-border pb-1"
          >
            {RANGES.map((r) => {
              const selected = r.id === range;
              return (
                <Link
                  key={r.id}
                  href={`/admin/kpi?range=${r.id}`}
                  role="tab"
                  aria-selected={selected}
                  className={cn(
                    "px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                    selected
                      ? "border border-border bg-card text-foreground"
                      : "border border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {r.label}
                </Link>
              );
            })}
          </div>
        </header>

        <div className="mt-10 space-y-12">
          <FinancialSection data={financial} />
          <RevenueTrendSection points={revenueTrend} />
          <div className="grid gap-8 lg:grid-cols-2">
            <FunnelSection stages={funnel} />
            <AreasSection areas={areas} />
          </div>
          <TechniciansSection rows={technicians} />
          <TechRevenueSection rows={technicians} />
          <AmcSection data={amc} />
          <OperationalSection data={operational} />
        </div>
      </div>
    </div>
  );
}
