"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Play, Plus, Trash2, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/relative-time";
import { Badge } from "@/components/ui/badge";
import { describeSegment, type SegmentSpec } from "@/lib/campaigns/segment";
import type { Campaign, CampaignRecipientStatus } from "@/lib/supabase/types";
import { createCampaign, deleteCampaign, launchCampaign, previewSegment } from "./actions";

export type CampaignWithCounts = Campaign & {
  template_params: string[];
  counts: Record<CampaignRecipientStatus, number>;
};

export function CampaignsClient({
  initial,
  templateOptions
}: {
  initial: CampaignWithCounts[];
  templateOptions: string[];
}) {
  const [composing, setComposing] = useState(false);

  return (
    <div className="surface-paper min-h-dvh">
      <div className="mx-auto max-w-4xl px-5 py-10 md:px-10 md:py-14">
        <Header total={initial.length} composing={composing} onCompose={() => setComposing((v) => !v)} />

        {composing && (
          <ComposeForm templateOptions={templateOptions} onDone={() => setComposing(false)} />
        )}

        <div className="mt-10">
          {initial.length === 0 && !composing ? (
            <EmptyState onCompose={() => setComposing(true)} />
          ) : (
            <ul className="space-y-5">
              {initial.map((c, i) => (
                <CampaignItem key={c.id} campaign={c} index={i} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Header({
  total,
  composing,
  onCompose
}: {
  total: number;
  composing: boolean;
  onCompose: () => void;
}) {
  return (
    <header>
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Outreach · Broadcast
      </p>
      <div className="mt-3 flex items-end justify-between gap-4">
        <h1 className="font-serif text-[44px] leading-[1.02] tracking-tight text-ink md:text-[56px]">
          Campaigns.
        </h1>
        <button
          type="button"
          onClick={onCompose}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 border px-3 py-2 text-[13px] font-medium transition-colors",
            composing
              ? "border-border bg-background text-muted-foreground hover:text-foreground"
              : "border-border bg-background text-foreground hover:border-primary hover:bg-primary hover:text-primary-foreground"
          )}
        >
          {composing ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {composing ? "Close" : "New campaign"}
        </button>
      </div>
      <p className="mt-3 text-base text-muted-foreground">
        {total === 0
          ? "No campaigns yet."
          : `${total} campaign${total === 1 ? "" : "s"} on file. Sends use approved templates and respect STOP.`}
      </p>
    </header>
  );
}

function ComposeForm({
  templateOptions,
  onDone
}: {
  templateOptions: string[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [templateChoice, setTemplateChoice] = useState(templateOptions[0] ?? "custom");
  const [customTemplate, setCustomTemplate] = useState("");
  const [params, setParams] = useState<string[]>(["{name}", "", ""]);
  const [area, setArea] = useState("");
  const [pestType, setPestType] = useState("");
  const [lastVisitMonths, setLastVisitMonths] = useState("");
  const [amcFilter, setAmcFilter] = useState<"any" | "with" | "without">("any");
  const [tag, setTag] = useState("");
  const [preview, setPreview] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const segment = useMemo<SegmentSpec>(() => {
    const spec: SegmentSpec = {};
    if (area.trim()) spec.area = area.trim();
    if (pestType.trim()) spec.pest_type = pestType.trim();
    const months = Number(lastVisitMonths);
    if (lastVisitMonths.trim() && Number.isFinite(months) && months > 0) {
      spec.last_visit_before_months = months;
    }
    if (amcFilter !== "any") spec.has_amc = amcFilter === "with";
    if (tag.trim()) spec.tag = tag.trim();
    return spec;
  }, [area, pestType, lastVisitMonths, amcFilter, tag]);

  const templateName = templateChoice === "custom" ? customTemplate.trim() : templateChoice;

  const runPreview = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const result = await previewSegment(segment);
      if (result.ok) setPreview(result.value.count);
      else setError(result.error);
    });
  }, [segment]);

  const submit = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const result = await createCampaign({
        name,
        template_name: templateName,
        template_params: params.map((p) => p.trim()).filter((p) => p !== ""),
        segment
      });
      if (result.ok) {
        setPreview(null);
        onDone();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }, [name, templateName, params, segment, onDone, router]);

  return (
    <section className="mt-8 border border-border bg-card px-5 py-5 md:px-7 md:py-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        New campaign · Draft first, launch deliberately
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Campaign name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Monsoon mosquito push"
            className={inputCls}
          />
        </Field>

        <Field label="Approved template">
          <div className="flex gap-2">
            <select
              value={templateChoice}
              onChange={(e) => setTemplateChoice(e.target.value)}
              className={cn(inputCls, "flex-1")}
            >
              {templateOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              <option value="custom">custom…</option>
            </select>
            {templateChoice === "custom" && (
              <input
                value={customTemplate}
                onChange={(e) => setCustomTemplate(e.target.value)}
                placeholder="my_campaign_template_v1"
                className={cn(inputCls, "flex-1 font-mono")}
              />
            )}
          </div>
        </Field>
      </div>

      <Field label="Body params {{1}}–{{3}} · {name} becomes the customer's first name" className="mt-4">
        <div className="grid gap-2 md:grid-cols-3">
          {params.map((p, i) => (
            <input
              key={i}
              value={p}
              onChange={(e) =>
                setParams((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
              }
              placeholder={i === 0 ? "{name}" : `param ${i + 1} (optional)`}
              className={cn(inputCls, "font-mono")}
            />
          ))}
        </div>
      </Field>

      <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Audience · leave blank for all reachable customers
      </p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <Field label="Area (address contains)">
          <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Koramangala" className={inputCls} />
        </Field>
        <Field label="Had this pest treated">
          <input value={pestType} onChange={(e) => setPestType(e.target.value)} placeholder="rats" className={inputCls} />
        </Field>
        <Field label="No visit in the last (months)">
          <input
            value={lastVisitMonths}
            onChange={(e) => setLastVisitMonths(e.target.value)}
            inputMode="numeric"
            placeholder="6"
            className={inputCls}
          />
        </Field>
        <Field label="AMC status">
          <select
            value={amcFilter}
            onChange={(e) => setAmcFilter(e.target.value as "any" | "with" | "without")}
            className={inputCls}
          >
            <option value="any">Any</option>
            <option value="without">Without AMC</option>
            <option value="with">With AMC</option>
          </select>
        </Field>
        <Field label="Has CRM tag">
          <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="vip" className={inputCls} />
        </Field>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <button type="button" onClick={runPreview} disabled={pending} className={buttonCls}>
          <Users className="h-3.5 w-3.5" />
          {pending ? "…" : "Preview audience"}
        </button>
        {preview !== null && (
          <span className="font-mono text-[12px] text-muted-foreground">
            {preview} customer{preview === 1 ? "" : "s"} · {describeSegment(segment)}
          </span>
        )}
        <div className="ml-auto">
          <button
            type="button"
            onClick={submit}
            disabled={pending || name.trim() === "" || templateName === ""}
            className={cn(buttonCls, "border-primary bg-primary text-primary-foreground hover:bg-primary/90")}
          >
            <Plus className="h-3.5 w-3.5" />
            {pending ? "Creating…" : "Create draft"}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 font-mono text-[11px] text-destructive">{error}</p>}
    </section>
  );
}

function CampaignItem({ campaign, index }: { campaign: CampaignWithCounts; index: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { counts } = campaign;
  const total = counts.queued + counts.sent + counts.skipped + counts.failed;

  const act = useCallback(
    (fn: (id: string) => Promise<{ ok: true; value: void } | { ok: false; error: string }>) => {
      setError(null);
      startTransition(async () => {
        const result = await fn(campaign.id);
        if (result.ok) router.refresh();
        else setError(result.error);
      });
    },
    [campaign.id, router]
  );

  return (
    <li
      className="border border-border bg-card px-5 py-5 animate-card-in md:px-6"
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={campaign.status === "sending" ? "default" : "muted"}>
              {campaign.status}
            </Badge>
            <h2 className="font-serif text-2xl leading-tight text-ink">{campaign.name}</h2>
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
            <span className="font-mono">{campaign.template_name}</span>
            <span className="text-muted-foreground/60">·</span>
            <span>{describeSegment((campaign.segment ?? {}) as SegmentSpec)}</span>
            <span className="text-muted-foreground/60">·</span>
            <RelativeTime iso={campaign.created_at} className="font-mono uppercase tracking-[0.12em]" />
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {campaign.status === "draft" && (
            <>
              <button type="button" onClick={() => act(launchCampaign)} disabled={pending} className={buttonCls}>
                <Play className="h-3.5 w-3.5" />
                {pending ? "…" : "Launch"}
              </button>
              <button
                type="button"
                onClick={() => act(deleteCampaign)}
                disabled={pending}
                aria-label="Delete draft"
                className={cn(buttonCls, "hover:border-destructive hover:bg-destructive hover:text-destructive-foreground")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        <Count label="Audience" value={total} />
        <Count label="Sent" value={counts.sent} highlight={counts.sent > 0} />
        <Count label="Queued" value={counts.queued} />
        <Count label="Skipped" value={counts.skipped} />
        <Count label="Failed" value={counts.failed} destructive={counts.failed > 0} />
      </dl>

      {error && <p className="mt-2 font-mono text-[11px] text-destructive">{error}</p>}
    </li>
  );
}

function Count({
  label,
  value,
  highlight,
  destructive
}: {
  label: string;
  value: number;
  highlight?: boolean;
  destructive?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt>{label}</dt>
      <dd
        className={cn(
          "tabular-nums",
          highlight && "text-primary",
          destructive && "text-destructive",
          !highlight && !destructive && "text-foreground/80"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function EmptyState({ onCompose }: { onCompose: () => void }) {
  return (
    <div className="border border-dashed border-border px-8 py-16 text-center">
      <Megaphone className="mx-auto h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        No campaigns yet
      </p>
      <h2 className="mt-3 font-serif text-3xl italic text-ink">Reach the right customers.</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        Pick an approved template, define a segment — area, pest history, visit age, AMC — and
        launch. Opted-out customers are skipped automatically.
      </p>
      <button type="button" onClick={onCompose} className={cn(buttonCls, "mt-6")}>
        <Plus className="h-3.5 w-3.5" />
        New campaign
      </button>
    </div>
  );
}

function Field({
  label,
  children,
  className
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none";

const buttonCls =
  "inline-flex items-center gap-1.5 border border-border bg-background px-3 py-2 text-[13px] font-medium text-foreground transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60";
