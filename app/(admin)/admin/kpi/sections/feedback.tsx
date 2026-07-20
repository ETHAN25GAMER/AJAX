import { MessageCircleHeart, Star, ThumbsDown, ThumbsUp } from "lucide-react";
import type { FeedbackKpis } from "@/lib/kpi/queries";
import { StatCard } from "./stat-card";

export function FeedbackSection({ data }: { data: FeedbackKpis }) {
  const delta =
    data.avgRating != null && data.previousAvg != null
      ? data.avgRating - data.previousAvg
      : null;

  return (
    <section>
      <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        Customer feedback
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Star}
          label="Average rating"
          value={data.avgRating == null ? "—" : data.avgRating.toFixed(1)}
          sub={
            delta == null
              ? "No previous-period data"
              : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} vs previous period`
          }
          tone={
            data.avgRating == null
              ? "default"
              : data.avgRating >= 4
              ? "good"
              : data.avgRating >= 3
              ? "warn"
              : "bad"
          }
        />
        <StatCard
          icon={MessageCircleHeart}
          label="Responses"
          value={data.responses}
          sub="Post-visit ratings received"
        />
        <StatCard
          icon={ThumbsUp}
          label="Promoters"
          value={data.promoters}
          sub="Rated 4–5 · sent the review link"
          tone={data.promoters > 0 ? "good" : "default"}
        />
        <StatCard
          icon={ThumbsDown}
          label="Detractors"
          value={data.detractors}
          sub="Rated 1–2 · escalated for follow-up"
          tone={data.detractors > 0 ? "bad" : "default"}
        />
      </div>

      {data.latestComments.length > 0 && (
        <ul className="mt-4 space-y-2">
          {data.latestComments.map((c, i) => (
            <li
              key={i}
              className="border border-border bg-card px-4 py-3 text-[13px] leading-relaxed text-foreground/90"
            >
              <span className="mr-2 font-mono text-[11px] text-muted-foreground">
                {c.rating}/5
              </span>
              “{c.comment}”
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
