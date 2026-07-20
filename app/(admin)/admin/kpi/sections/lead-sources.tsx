import { Megaphone } from "lucide-react";
import type { LeadSource } from "@/lib/kpi/queries";

// Where new customers came from: click-to-WhatsApp ads (first-touch stamped by
// the webhook) vs organic. Bar list, same visual grammar as the areas section.
export function LeadSourcesSection({ sources }: { sources: LeadSource[] }) {
  const total = sources.reduce((a, s) => a + s.count, 0);

  return (
    <section>
      <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        Lead sources
      </h2>
      {total === 0 ? (
        <div className="border border-dashed border-border px-6 py-10 text-center">
          <Megaphone className="mx-auto h-6 w-6 text-muted-foreground/40" aria-hidden="true" />
          <p className="mt-3 text-sm text-muted-foreground">
            No new customers in this range yet.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {sources.map((s) => {
            const share = s.count / total;
            return (
              <li key={s.source} className="border border-border bg-card px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[13px] text-foreground">{s.source}</span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {s.count} · {Math.round(share * 100)}%
                  </span>
                </div>
                <div className="mt-2 h-1 w-full bg-secondary">
                  <div
                    className="h-1 bg-primary"
                    style={{ width: `${Math.max(share * 100, 2)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
