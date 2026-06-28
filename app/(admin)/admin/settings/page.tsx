import { BarChart3, CheckCircle2 } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { getDeploymentSettings } from "@/lib/tier";
import { absShort } from "@/lib/time";
import type { DeploymentTier } from "@/lib/supabase/types";
import { TierToggleForm } from "./tier-toggle-form";

export const metadata = { title: "Settings — PestLLM" };
export const dynamic = "force-dynamic";

const TIER_COPY: Record<DeploymentTier, { name: string; blurb: string }> = {
  tier2: {
    name: "Tier 2 — Operate",
    blurb:
      "WhatsApp agent, admin console, technician PWA, AMC, GPS tracking, auto-assignment."
  },
  tier3: {
    name: "Tier 3 — Measure",
    blurb:
      "Everything in tier 2, plus the KPI dashboard: revenue, AMC recurring revenue, per-technician performance, and operational health."
  }
};

export default async function SettingsPage() {
  await requireRole("admin");
  const sb = await createSupabaseServerClient();
  const settings = await getDeploymentSettings(sb);

  let updatedByLabel: string | null = null;
  if (settings.updated_by) {
    const { data } = await sb
      .from("profiles")
      .select("full_name")
      .eq("id", settings.updated_by)
      .maybeSingle<{ full_name: string | null }>();
    updatedByLabel = data?.full_name?.trim() || settings.updated_by.slice(0, 8);
  }

  const next: DeploymentTier = settings.tier === "tier2" ? "tier3" : "tier2";
  const copy = TIER_COPY[settings.tier];
  const nextCopy = TIER_COPY[next];

  return (
    <div className="surface-paper min-h-dvh">
      <div className="mx-auto max-w-3xl px-5 py-10 md:px-10 md:py-14">
        <header>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Deployment
          </p>
          <h1 className="mt-3 font-serif text-[44px] leading-[1.02] tracking-tight text-ink md:text-[56px]">
            Settings.
          </h1>
          <p className="mt-3 text-base text-muted-foreground">
            One client per deployment. Flip the tier here — instant, no redeploy.
          </p>
        </header>

        <section className="mt-10 border border-border bg-card p-6 md:p-8">
          <div className="flex items-center justify-between gap-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Current tier
            </p>
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-primary">
              <CheckCircle2 className="h-3 w-3" />
              Active
            </span>
          </div>
          <h2 className="mt-4 font-serif text-3xl text-ink md:text-4xl">{copy.name}</h2>
          <p className="mt-3 max-w-prose text-[14px] text-muted-foreground">{copy.blurb}</p>

          <dl className="mt-6 grid gap-x-8 gap-y-2 text-[12px] sm:grid-cols-2">
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Last changed
              </dt>
              <dd className="mt-1 font-mono text-foreground">
                {new Date(settings.updated_at).getTime() === 0
                  ? "—"
                  : absShort(settings.updated_at)}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Changed by
              </dt>
              <dd className="mt-1 font-mono text-foreground">{updatedByLabel ?? "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="mt-8 border border-dashed border-border bg-card p-6 md:p-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Available action
          </p>
          <h3 className="mt-3 font-serif text-2xl text-ink">{nextCopy.name}</h3>
          <p className="mt-2 max-w-prose text-[13px] text-muted-foreground">{nextCopy.blurb}</p>

          <div className="mt-5">
            <TierToggleForm
              current={settings.tier}
              next={next}
              label={settings.tier === "tier2" ? "Upgrade to tier 3" : "Downgrade to tier 2"}
            />
          </div>

          {next === "tier3" && (
            <p className="mt-4 inline-flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <BarChart3 className="h-3 w-3" />
              Unlocks /admin/kpi for this deployment.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
