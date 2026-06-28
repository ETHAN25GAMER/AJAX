import { FileClock, Repeat, AlertCircle, XCircle } from "lucide-react";
import type { AmcKpis } from "@/lib/kpi/queries";
import { StatCard } from "./stat-card";

export function AmcSection({ data }: { data: AmcKpis }) {
  return (
    <section>
      <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        AMC / Recurring revenue
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={FileClock}
          label="Active contracts"
          value={data.activeCount}
          sub={`${data.activeCount === 1 ? "contract" : "contracts"} currently active`}
        />
        <StatCard
          icon={Repeat}
          label="Annual recurring revenue"
          value={formatMoney(data.annualRecurringRevenue)}
          sub="Sum of active annual_price"
          tone="good"
        />
        <StatCard
          icon={AlertCircle}
          label="Renewals due ≤30d"
          value={data.renewalsDueIn30Days}
          sub="Active contracts with renews_at in next 30 days"
          tone={data.renewalsDueIn30Days > 0 ? "warn" : "default"}
        />
        <StatCard
          icon={XCircle}
          label="Churn in range"
          value={data.churnedInRange}
          sub="Cancelled or expired this period"
          tone={data.churnedInRange > 0 ? "bad" : "default"}
        />
      </div>
    </section>
  );
}

function formatMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
