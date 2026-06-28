import { AlertTriangle, CheckSquare, CalendarX, UserX } from "lucide-react";
import type { OperationalKpis } from "@/lib/kpi/queries";
import { StatCard } from "./stat-card";

export function OperationalSection({ data }: { data: OperationalKpis }) {
  const resolveRate =
    data.escalationsOpened === 0
      ? null
      : data.escalationsResolved / data.escalationsOpened;

  return (
    <section>
      <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        Operational
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={AlertTriangle}
          label="Escalations opened"
          value={data.escalationsOpened}
          sub={
            data.highUrgency > 0
              ? `${data.highUrgency} high-urgency`
              : "None high-urgency"
          }
          tone={data.highUrgency > 0 ? "bad" : "default"}
        />
        <StatCard
          icon={CheckSquare}
          label="Resolved"
          value={data.escalationsResolved}
          sub={
            resolveRate == null
              ? "—"
              : `${Math.round(resolveRate * 100)}% resolution rate`
          }
          tone={resolveRate != null && resolveRate >= 0.8 ? "good" : "default"}
        />
        <StatCard
          icon={CalendarX}
          label="Cancellation rate"
          value={`${Math.round(data.cancellationRate * 100)}%`}
          sub="Of bookings in this range"
          tone={data.cancellationRate >= 0.2 ? "bad" : data.cancellationRate >= 0.1 ? "warn" : "good"}
        />
        <StatCard
          icon={UserX}
          label="No-shows"
          value={data.noShowCount}
          sub="Booked, slot passed, not completed"
          tone={data.noShowCount > 0 ? "warn" : "default"}
        />
      </div>
    </section>
  );
}
