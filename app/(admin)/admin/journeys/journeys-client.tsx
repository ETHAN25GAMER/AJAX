"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, Pause, Play, Plus, Route, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/relative-time";
import { Badge } from "@/components/ui/badge";
import type { Journey, JourneyEnrollmentStatus, JourneyStep, JourneyTrigger } from "@/lib/supabase/types";
import { createJourney, deleteJourney, setJourneyEnabled } from "./actions";

export type JourneyWithDetail = Journey & {
  steps: JourneyStep[];
  counts: Record<JourneyEnrollmentStatus, number>;
};

const TRIGGER_LABEL: Record<JourneyTrigger, string> = {
  job_completed: "After a job is completed",
  customer_created: "When a new customer appears"
};

type DraftStep = { delay_days: string; template_name: string; params: string[] };

export function JourneysClient({
  initial,
  templateOptions
}: {
  initial: JourneyWithDetail[];
  templateOptions: string[];
}) {
  const [composing, setComposing] = useState(false);

  return (
    <div className="surface-paper min-h-dvh">
      <div className="mx-auto max-w-4xl px-5 py-10 md:px-10 md:py-14">
        <header>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Automation · Sequences
          </p>
          <div className="mt-3 flex items-end justify-between gap-4">
            <h1 className="font-serif text-[44px] leading-[1.02] tracking-tight text-ink md:text-[56px]">
              Journeys.
            </h1>
            <button
              type="button"
              onClick={() => setComposing((v) => !v)}
              className={cn(
                buttonCls,
                !composing &&
                  "hover:border-primary hover:bg-primary hover:text-primary-foreground"
              )}
            >
              {composing ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {composing ? "Close" : "New journey"}
            </button>
          </div>
          <p className="mt-3 text-base text-muted-foreground">
            Trigger → wait → send an approved template → wait → send. Opted-out customers drop
            out automatically; enabling never messages past history.
          </p>
        </header>

        {composing && (
          <ComposeForm templateOptions={templateOptions} onDone={() => setComposing(false)} />
        )}

        <div className="mt-10">
          {initial.length === 0 && !composing ? (
            <EmptyState onCompose={() => setComposing(true)} />
          ) : (
            <ul className="space-y-5">
              {initial.map((j) => (
                <JourneyItem key={j.id} journey={j} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
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
  const [trigger, setTrigger] = useState<JourneyTrigger>("job_completed");
  const [steps, setSteps] = useState<DraftStep[]>([
    { delay_days: "30", template_name: "", params: ["{name}", "", ""] }
  ]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const patchStep = (i: number, patch: Partial<DraftStep>) =>
    setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const submit = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const result = await createJourney({
        name,
        trigger,
        steps: steps.map((s) => ({
          delay_days: s.delay_days,
          template_name: s.template_name.trim(),
          template_params: s.params.map((p) => p.trim()).filter((p) => p !== "")
        }))
      });
      if (result.ok) {
        onDone();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }, [name, trigger, steps, onDone, router]);

  return (
    <section className="mt-8 border border-border bg-card px-5 py-5 md:px-7 md:py-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        New journey · Created disabled — enable when you're happy with it
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Journey name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="30-day check-in"
            className={inputCls}
          />
        </Field>
        <Field label="Trigger">
          <select
            value={trigger}
            onChange={(e) => setTrigger(e.target.value as JourneyTrigger)}
            className={inputCls}
          >
            <option value="job_completed">{TRIGGER_LABEL.job_completed}</option>
            <option value="customer_created">{TRIGGER_LABEL.customer_created}</option>
          </select>
        </Field>
      </div>

      <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Steps · approved templates only · {"{name}"} becomes the customer's first name
      </p>
      <ol className="mt-3 space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="border border-dashed border-border p-3">
            <div className="grid gap-3 md:grid-cols-[110px_1fr_auto]">
              <Field label={`Wait (days)`}>
                <input
                  value={s.delay_days}
                  onChange={(e) => patchStep(i, { delay_days: e.target.value })}
                  inputMode="numeric"
                  className={cn(inputCls, "font-mono")}
                />
              </Field>
              <Field label="Template">
                <div className="flex gap-2">
                  <input
                    list="journey-template-options"
                    value={s.template_name}
                    onChange={(e) => patchStep(i, { template_name: e.target.value })}
                    placeholder="my_checkin_template_v1"
                    className={cn(inputCls, "font-mono")}
                  />
                </div>
              </Field>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
                  disabled={steps.length === 1}
                  aria-label={`Remove step ${i + 1}`}
                  className={cn(buttonCls, "disabled:opacity-40")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              {s.params.map((p, pi) => (
                <input
                  key={pi}
                  value={p}
                  onChange={(e) =>
                    patchStep(i, {
                      params: s.params.map((v, pj) => (pj === pi ? e.target.value : v))
                    })
                  }
                  placeholder={pi === 0 ? "{name}" : `param ${pi + 1} (optional)`}
                  className={cn(inputCls, "font-mono")}
                />
              ))}
            </div>
          </li>
        ))}
      </ol>
      <datalist id="journey-template-options">
        {templateOptions.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
        <button
          type="button"
          onClick={() =>
            setSteps((prev) => [
              ...prev,
              { delay_days: "7", template_name: "", params: ["{name}", "", ""] }
            ])
          }
          disabled={steps.length >= 10}
          className={buttonCls}
        >
          <Plus className="h-3.5 w-3.5" />
          Add step
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || name.trim() === "" || steps.some((s) => s.template_name.trim() === "")}
          className={cn(buttonCls, "border-primary bg-primary text-primary-foreground hover:bg-primary/90")}
        >
          <Plus className="h-3.5 w-3.5" />
          {pending ? "Creating…" : "Create (disabled)"}
        </button>
      </div>
      {error && <p className="mt-3 font-mono text-[11px] text-destructive">{error}</p>}
    </section>
  );
}

function JourneyItem({ journey }: { journey: JourneyWithDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const act = useCallback(
    (fn: () => Promise<{ ok: true; value: void } | { ok: false; error: string }>) => {
      setError(null);
      startTransition(async () => {
        const result = await fn();
        if (result.ok) router.refresh();
        else setError(result.error);
      });
    },
    [router]
  );

  return (
    <li className="border border-border bg-card px-5 py-5 md:px-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={journey.enabled ? "default" : "muted"}>
              {journey.enabled ? "enabled" : "disabled"}
            </Badge>
            <h2 className="font-serif text-2xl leading-tight text-ink">{journey.name}</h2>
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
            <span>{TRIGGER_LABEL[journey.trigger]}</span>
            <span className="text-muted-foreground/60">·</span>
            <RelativeTime iso={journey.created_at} className="font-mono uppercase tracking-[0.12em]" />
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => act(() => setJourneyEnabled(journey.id, !journey.enabled))}
            disabled={pending}
            className={buttonCls}
          >
            {journey.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {pending ? "…" : journey.enabled ? "Disable" : "Enable"}
          </button>
          {!journey.enabled && (
            <button
              type="button"
              onClick={() => act(() => deleteJourney(journey.id))}
              disabled={pending}
              aria-label="Delete journey"
              className={cn(buttonCls, "hover:border-destructive hover:bg-destructive hover:text-destructive-foreground")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <ol className="mt-4 space-y-1.5 border-t border-border pt-3">
        {journey.steps.map((s, i) => (
          <li key={s.position} className="flex items-center gap-2 text-[12px] text-muted-foreground">
            {i > 0 && <ArrowDown className="h-3 w-3 text-muted-foreground/50" aria-hidden="true" />}
            <span className="font-mono tabular-nums">
              {s.delay_days === 0 ? "immediately" : `+${s.delay_days}d`}
            </span>
            <span className="text-muted-foreground/60">→</span>
            <span className="font-mono text-foreground/80">{s.template_name}</span>
          </li>
        ))}
      </ol>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        <div className="flex items-baseline gap-1.5">
          <dt>Active</dt>
          <dd className={cn("tabular-nums", journey.counts.active > 0 ? "text-primary" : "text-foreground/80")}>
            {journey.counts.active}
          </dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt>Completed</dt>
          <dd className="tabular-nums text-foreground/80">{journey.counts.done}</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt>Dropped out</dt>
          <dd className="tabular-nums text-foreground/80">{journey.counts.cancelled}</dd>
        </div>
      </dl>

      {error && <p className="mt-2 font-mono text-[11px] text-destructive">{error}</p>}
    </li>
  );
}

function EmptyState({ onCompose }: { onCompose: () => void }) {
  return (
    <div className="border border-dashed border-border px-8 py-16 text-center">
      <Route className="mx-auto h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        No journeys yet
      </p>
      <h2 className="mt-3 font-serif text-3xl italic text-ink">Put follow-ups on rails.</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        A 30-day check-in after every job, a win-back after six quiet months — compose it once
        and the cron runs it forever.
      </p>
      <button type="button" onClick={onCompose} className={cn(buttonCls, "mt-6")}>
        <Plus className="h-3.5 w-3.5" />
        New journey
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
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
  "inline-flex items-center gap-1.5 border border-border bg-background px-3 py-2 text-[13px] font-medium text-foreground transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-60";
