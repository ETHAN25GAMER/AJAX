import type { RevenuePoint } from "@/lib/kpi/queries";

// Server-rendered SVG line chart: solid actual line + dashed forecast tail.
// The actual line "draws in" on load via the .kpi-line CSS animation.
export function RevenueTrendSection({ points }: { points: RevenuePoint[] }) {
  const W = 800;
  const H = 200;
  const padX = 18;
  const padY = 22;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  const max = Math.max(...points.map((p) => p.value), 1);
  const n = points.length;
  const x = (i: number) => padX + (n <= 1 ? 0 : (innerW * i) / (n - 1));
  const y = (v: number) => padY + innerH * (1 - v / max);

  const lastActualIdx = Math.max(0, points.map((p) => p.forecast).lastIndexOf(false));
  const actual = points.slice(0, lastActualIdx + 1);
  const forecast = points.slice(lastActualIdx); // include join point

  const toPath = (pts: { i: number; v: number }[]) =>
    pts.map((p, k) => `${k === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");

  const actualPath = toPath(actual.map((p, i) => ({ i, v: p.value })));
  const forecastPath = toPath(
    forecast.map((p, k) => ({ i: lastActualIdx + k, v: p.value }))
  );

  const latest = points[lastActualIdx]?.value ?? 0;
  const hasData = points.some((p) => p.value > 0);

  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          Revenue trend
        </h2>
        <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-3 bg-primary" /> Actual
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0 w-3 border-t-2 border-dashed border-muted-foreground" />
            Forecast
          </span>
        </div>
      </div>

      <div className="border border-border bg-card p-5">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Monthly revenue · est.
          </p>
          <p className="font-serif text-[28px] leading-none text-ink">{money(latest)}</p>
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="mt-4 w-full"
          role="img"
          aria-label="Monthly revenue trend"
        >
          {/* baseline grid */}
          {[0, 0.5, 1].map((g) => (
            <line
              key={g}
              x1={padX}
              x2={W - padX}
              y1={padY + innerH * g}
              y2={padY + innerH * g}
              stroke="currentColor"
              className="text-border"
              strokeWidth={1}
            />
          ))}

          {hasData && (
            <>
              <path
                d={forecastPath}
                fill="none"
                stroke="currentColor"
                className="text-muted-foreground/70"
                strokeWidth={2}
                strokeDasharray="5 5"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={actualPath}
                pathLength={1}
                fill="none"
                stroke="currentColor"
                className="kpi-line text-primary"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {points.map((p, i) => (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(p.value)}
                  r={p.forecast ? 3 : 3.5}
                  className={p.forecast ? "fill-card stroke-muted-foreground" : "fill-primary"}
                  strokeWidth={p.forecast ? 1.5 : 0}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </>
          )}
        </svg>

        <div className="mt-2 grid" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
          {points.map((p, i) => (
            <span
              key={i}
              className="text-center font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground"
            >
              {p.label}
            </span>
          ))}
        </div>

        {!hasData && (
          <p className="mt-3 text-center text-[12px] text-muted-foreground">
            No completed jobs yet — revenue appears once visits are marked complete.
          </p>
        )}
      </div>
    </section>
  );
}

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
