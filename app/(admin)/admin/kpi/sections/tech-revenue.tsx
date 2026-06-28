import type { TechnicianKpi } from "@/lib/kpi/queries";

// Revenue by technician — ranked horizontal bars (est. value of completed jobs).
export function TechRevenueSection({ rows }: { rows: TechnicianKpi[] }) {
  const ranked = [...rows].filter((r) => r.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  const max = Math.max(...ranked.map((r) => r.revenue), 1);

  return (
    <section>
      <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        Revenue by technician · est.
      </h2>
      <div className="border border-border bg-card p-5">
        {ranked.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-muted-foreground">
            No completed jobs attributed to technicians this period.
          </p>
        ) : (
          <ul className="space-y-4">
            {ranked.map((t, i) => (
              <li key={t.id}>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="truncate text-foreground">
                    <span className="mr-2 font-mono text-[11px] text-muted-foreground">{i + 1}</span>
                    {t.name}
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {money(t.revenue)}
                    <span className="mx-1.5 text-muted-foreground/60">·</span>
                    {t.completed} job{t.completed === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full bg-border/50">
                  <div
                    className="kpi-bar h-full bg-primary"
                    style={{ width: `${(t.revenue / max) * 100}%`, animationDelay: `${i * 80}ms` }}
                    aria-hidden
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
