import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "default"
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const accent =
    tone === "good"
      ? "text-primary border-primary/40"
      : tone === "warn"
      ? "text-urgency-normal border-urgency-normal/40"
      : tone === "bad"
      ? "text-urgency-high border-urgency-high/40"
      : "text-muted-foreground border-border";

  return (
    <div
      className={cn(
        "border bg-card p-5",
        accent.split(" ").find((c) => c.startsWith("border-"))
      )}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em]",
          accent.split(" ").find((c) => c.startsWith("text-"))
        )}
      >
        {Icon && <Icon className="h-3 w-3" aria-hidden />}
        {label}
      </span>
      <div className="mt-6">
        <span className="font-serif text-[44px] leading-none tracking-tight text-ink">
          {value}
        </span>
      </div>
      {sub && <p className="mt-2 text-[12px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
