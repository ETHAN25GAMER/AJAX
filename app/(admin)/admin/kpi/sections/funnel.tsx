import type { FunnelStage } from "@/lib/kpi/queries";
import { cn } from "@/lib/utils";

// Lead → booking funnel. Bars grow in via .kpi-bar. The last stage (Cancelled)
// is leakage, shown in the danger tone.
export function FunnelSection({ stages }: { stages: FunnelStage[] }) {
  const empty = stages.every((s) => s.n === 0);

  return (
    <section>
      <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        Lead → booking funnel
      </h2>
      <div className="border border-border bg-card p-5">
        {empty ? (
          <p className="py-8 text-center text-[12px] text-muted-foreground">
            No activity in this period yet.
          </p>
        ) : (
          <ul className="space-y-4">
            {stages.map((s, i) => {
              const leak = s.label === "Cancelled";
              return (
                <li key={s.label}>
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className={cn(leak ? "text-urgency-high" : "text-foreground")}>
                      {s.label}
                    </span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {s.n}
                      <span className="mx-1.5 text-muted-foreground/60">·</span>
                      {Math.round(s.pct)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full bg-border/50">
                    <div
                      className={cn("kpi-bar h-full", leak ? "bg-urgency-high" : "bg-primary")}
                      style={{ width: `${Math.max(s.pct, s.n > 0 ? 2 : 0)}%`, animationDelay: `${i * 90}ms` }}
                      aria-hidden
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
          Leads = new customers · % vs leads
        </p>
      </div>
    </section>
  );
}
