import type { AreaCount } from "@/lib/kpi/queries";

// Busiest service areas, by Singapore postal region (heatmap grid).
export function AreasSection({ areas }: { areas: AreaCount[] }) {
  const max = Math.max(...areas.map((a) => a.count), 1);
  const total = areas.reduce((s, a) => s + a.count, 0);

  return (
    <section>
      <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        Busiest areas
      </h2>
      <div className="border border-border bg-card p-5">
        {total === 0 ? (
          <p className="py-8 text-center text-[12px] text-muted-foreground">
            No jobs with a recognised address this period.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {areas.map((a) => {
              const intensity = a.count / max; // 0..1
              return (
                <div
                  key={a.region}
                  className="border border-border p-3"
                  style={{ backgroundColor: `hsl(var(--primary) / ${(0.08 + intensity * 0.42).toFixed(3)})` }}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {a.region}
                  </p>
                  <p className="mt-1 font-serif text-[26px] leading-none text-ink">{a.count}</p>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
          Approx. from postal code · darker = busier
        </p>
      </div>
    </section>
  );
}
