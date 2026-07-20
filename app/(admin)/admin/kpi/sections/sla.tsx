import { MessageSquare, Timer, UserCheck, Zap } from "lucide-react";
import type { SlaKpis } from "@/lib/kpi/queries";
import { StatCard } from "./stat-card";

export function SlaSection({ data }: { data: SlaKpis }) {
  return (
    <section>
      <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        Responsiveness
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Zap}
          label="Median first reply"
          value={formatLatency(data.medianReplyMs)}
          sub="Customer message → our reply"
          tone={toneForLatency(data.medianReplyMs)}
        />
        <StatCard
          icon={Timer}
          label="P90 first reply"
          value={formatLatency(data.p90ReplyMs)}
          sub="Slowest 10% wait this long"
          tone={toneForLatency(data.p90ReplyMs)}
        />
        <StatCard
          icon={MessageSquare}
          label="Inbound messages"
          value={data.inboundCount}
          sub={`${data.agentReplies + data.staffReplies} replies sent`}
        />
        <StatCard
          icon={UserCheck}
          label="Human-handled"
          value={data.staffShare == null ? "—" : `${Math.round(data.staffShare * 100)}%`}
          sub={`${data.staffReplies} staff repl${data.staffReplies === 1 ? "y" : "ies"} · rest by Ajax`}
        />
      </div>
    </section>
  );
}

function formatLatency(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

// The agent replies in seconds; anything in minutes means webhook trouble or a
// human-held thread waiting on staff.
function toneForLatency(ms: number | null): "default" | "good" | "warn" | "bad" {
  if (ms == null) return "default";
  if (ms < 60_000) return "good";
  if (ms < 15 * 60_000) return "warn";
  return "bad";
}
