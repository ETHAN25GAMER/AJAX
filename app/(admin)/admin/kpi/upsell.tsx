import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";

export function Upsell() {
  return (
    <div className="surface-paper min-h-dvh">
      <div className="mx-auto max-w-3xl px-5 py-10 md:px-10 md:py-14">
        <header>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            <Lock className="mr-1.5 inline h-3 w-3 -translate-y-px" />
            Tier 3 — locked
          </p>
          <h1 className="mt-3 font-serif text-[44px] leading-[1.02] tracking-tight text-ink md:text-[56px]">
            Unlock company performance.
          </h1>
          <p className="mt-3 max-w-prose text-base text-muted-foreground">
            The KPI dashboard surfaces revenue, recurring AMC income, per-technician
            performance, and operational health — measured against the previous period.
            Available on tier 3.
          </p>
        </header>

        <section className="mt-10 grid gap-4 sm:grid-cols-2">
          <Bullet
            title="Financial"
            blurb="Revenue, average ticket, breakdown by service tier, trend vs the previous period."
          />
          <Bullet
            title="AMC / recurring revenue"
            blurb="Active contracts, annual recurring revenue, renewals due in the next 30 days, churn."
          />
          <Bullet
            title="Technician performance"
            blurb="Per-technician: jobs completed, completion rate, average job time, escalation rate, photo compliance."
          />
          <Bullet
            title="Operational health"
            blurb="Escalations opened vs resolved, high-urgency counts, cancellation rate, no-shows."
          />
        </section>

        <div className="mt-10 border border-primary/30 bg-card p-6 md:p-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
            <Sparkles className="mr-1.5 inline h-3 w-3 -translate-y-px" />
            Upgrade this deployment
          </p>
          <h2 className="mt-3 font-serif text-2xl text-ink md:text-3xl">
            Flip the tier and refresh.
          </h2>
          <p className="mt-2 max-w-prose text-[13px] text-muted-foreground">
            Promotes this Supabase project to tier 3. No redeploy, no migration —
            takes effect immediately.
          </p>
          <Link
            href="/admin/settings"
            className="mt-5 inline-flex items-center gap-1.5 border border-primary bg-primary px-4 py-2 font-mono text-[12px] uppercase tracking-[0.14em] text-primary-foreground transition-opacity hover:opacity-90"
          >
            Go to Settings
          </Link>
        </div>
      </div>
    </div>
  );
}

function Bullet({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="border border-border bg-card p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </p>
      <p className="mt-3 text-[13px] text-muted-foreground">{blurb}</p>
    </div>
  );
}
