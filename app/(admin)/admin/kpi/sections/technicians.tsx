import type { TechnicianKpi } from "@/lib/kpi/queries";
import { cn } from "@/lib/utils";

export function TechniciansSection({ rows }: { rows: TechnicianKpi[] }) {
  return (
    <section>
      <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        Technician performance
      </h2>

      {rows.length === 0 ? (
        <div className="border border-dashed border-border bg-card px-5 py-10 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            No technicians on the roster
          </p>
        </div>
      ) : (
        <div className="border border-border bg-card">
          <div
            className="grid items-center gap-3 border-b border-border px-5 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
            style={{ gridTemplateColumns: "minmax(0,1.4fr) repeat(5, minmax(0,1fr))" }}
          >
            <span>Technician</span>
            <span className="text-right">Completed</span>
            <span className="text-right">Completion</span>
            <span className="text-right">Avg time</span>
            <span className="text-right">Escalations</span>
            <span className="text-right">Photos</span>
          </div>

          <ul className="divide-y divide-border">
            {rows.map((t) => (
              <li
                key={t.id}
                className="grid items-center gap-3 px-5 py-4"
                style={{ gridTemplateColumns: "minmax(0,1.4fr) repeat(5, minmax(0,1fr))" }}
              >
                <div className="min-w-0">
                  <p className="truncate font-serif text-[18px] text-ink">{t.name}</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {t.completed + t.booked + t.cancelled} job
                    {t.completed + t.booked + t.cancelled === 1 ? "" : "s"} this period
                  </p>
                </div>
                <Metric value={t.completed} />
                <Metric
                  value={`${Math.round(t.completionRate * 100)}%`}
                  tone={t.completionRate >= 0.8 ? "good" : t.completionRate >= 0.5 ? "warn" : "bad"}
                />
                <Metric
                  value={t.avgJobMinutes == null ? "—" : `${t.avgJobMinutes}m`}
                />
                <Metric
                  value={t.escalations}
                  tone={t.escalations === 0 ? "good" : t.escalations > 2 ? "bad" : "warn"}
                />
                <Metric
                  value={`${Math.round(t.photoCompliance * 100)}%`}
                  tone={
                    t.photoCompliance >= 0.9 ? "good" : t.photoCompliance >= 0.6 ? "warn" : "bad"
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Metric({
  value,
  tone = "default"
}: {
  value: string | number;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const color =
    tone === "good"
      ? "text-primary"
      : tone === "warn"
      ? "text-urgency-normal"
      : tone === "bad"
      ? "text-urgency-high"
      : "text-foreground";
  return (
    <span className={cn("text-right font-mono text-[14px] tabular-nums", color)}>
      {value}
    </span>
  );
}
