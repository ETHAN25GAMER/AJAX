import { DollarSign, Receipt, TrendingDown, TrendingUp } from "lucide-react";
import type { FinancialKpis } from "@/lib/kpi/queries";
import type { ServiceTier } from "@/lib/supabase/types";
import { StatCard } from "./stat-card";

const TIERS: ServiceTier[] = ["standard", "plus", "specialist"];

export function FinancialSection({ data }: { data: FinancialKpis }) {
  const delta = data.previousRevenue === 0
    ? null
    : (data.revenue - data.previousRevenue) / data.previousRevenue;

  return (
    <section>
      <SectionHeader title="Financial" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={DollarSign}
          label="Revenue"
          value={formatMoney(data.revenue)}
          sub={
            delta == null
              ? "No comparable previous period."
              : `${delta >= 0 ? "▲" : "▼"} ${(Math.abs(delta) * 100).toFixed(1)}% vs previous`
          }
          tone={delta != null && delta >= 0 ? "good" : delta != null ? "warn" : "default"}
        />
        <StatCard
          icon={Receipt}
          label="Avg ticket"
          value={formatMoney(data.avgTicket)}
          sub={`${data.completedCount} completed job${data.completedCount === 1 ? "" : "s"}`}
        />
        <StatCard
          icon={delta != null && delta >= 0 ? TrendingUp : TrendingDown}
          label="Previous period"
          value={formatMoney(data.previousRevenue)}
          sub="Same length window"
        />
      </div>

      <div className="mt-6 border border-border bg-card p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Revenue by tier
        </p>
        <ul className="mt-4 space-y-3">
          {TIERS.map((tier) => {
            const row = data.byTier[tier];
            const pct = data.revenue === 0 ? 0 : (row.revenue / data.revenue) * 100;
            return (
              <li key={tier}>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="capitalize text-foreground">{tier}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {formatMoney(row.revenue)}
                    <span className="mx-1.5 text-muted-foreground/60">·</span>
                    {row.count} job{row.count === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-1.5 h-1 w-full bg-border/60">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${pct}%` }}
                    aria-hidden
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
      {title}
    </h2>
  );
}

function formatMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
