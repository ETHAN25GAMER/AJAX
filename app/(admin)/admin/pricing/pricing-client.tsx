"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { Check, Loader2, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createPricing, deletePricing, updatePricing } from "./actions";
import type { PricingRow } from "@/lib/supabase/types";

type DraftRule = {
  pest_type: string;
  base_price: string;
  per_sqft: string;
  notes: string;
  requires_inspection: boolean;
};

const EMPTY_DRAFT: DraftRule = {
  pest_type: "",
  base_price: "0",
  per_sqft: "0",
  notes: "",
  requires_inspection: false
};

export function PricingClient({ initial }: { initial: PricingRow[] }) {
  const [rows, setRows] = useState<PricingRow[]>(() => sortRows(initial));
  const [adding, setAdding] = useState(false);

  const groups = useMemo(() => groupByPest(rows), [rows]);

  const onRowUpdated = useCallback((updated: PricingRow) => {
    setRows((prev) => sortRows(prev.map((r) => (r.id === updated.id ? updated : r))));
  }, []);

  const onRowDeleted = useCallback((id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const onRowCreated = useCallback((created: PricingRow) => {
    setRows((prev) => sortRows([...prev, created]));
  }, []);

  return (
    <div className="surface-paper min-h-dvh">
      <div className="mx-auto max-w-4xl px-5 py-10 md:px-10 md:py-14">
        <Header ruleCount={rows.length} pestCount={groups.length} />

        <div className="mt-10 space-y-10">
          {groups.map((g, gi) => (
            <PestGroup
              key={g.pest_type}
              pestType={g.pest_type}
              rules={g.rules}
              groupIndex={gi}
              onUpdated={onRowUpdated}
              onDeleted={onRowDeleted}
            />
          ))}
        </div>

        <div className="mt-14 border-t border-border pt-6">
          {adding ? (
            <AddRuleForm
              onCancel={() => setAdding(false)}
              onCreated={(r) => {
                onRowCreated(r);
                setAdding(false);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-2 border border-dashed border-border bg-background px-4 py-2 text-[13px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add pricing rule
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Header({ ruleCount, pestCount }: { ruleCount: number; pestCount: number }) {
  return (
    <header>
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Configuration · Service catalog
        </p>
      </div>
      <h1 className="mt-3 font-serif text-[44px] leading-[1.02] tracking-tight text-ink md:text-[56px]">
        Pricing.
      </h1>
      <p className="mt-3 text-base text-muted-foreground">
        {ruleCount === 0
          ? "No pricing rules yet."
          : `${ruleCount} rule${ruleCount === 1 ? "" : "s"} · ${pestCount} pest type${pestCount === 1 ? "" : "s"} · one flat price per pest.`}
      </p>
    </header>
  );
}

function PestGroup({
  pestType,
  rules,
  groupIndex,
  onUpdated,
  onDeleted
}: {
  pestType: string;
  rules: PricingRow[];
  groupIndex: number;
  onUpdated: (row: PricingRow) => void;
  onDeleted: (id: string) => void;
}) {
  return (
    <section>
      <h2
        className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground"
        style={{ animationDelay: `${groupIndex * 70}ms` }}
      >
        {pestType}
      </h2>
      <ul className="divide-y divide-border border border-border bg-card">
        {rules.map((rule, i) => (
          <PricingRowEditor
            key={rule.id}
            initial={rule}
            index={groupIndex * 100 + i}
            onUpdated={onUpdated}
            onDeleted={onDeleted}
          />
        ))}
      </ul>
    </section>
  );
}

function PricingRowEditor({
  initial,
  index,
  onUpdated,
  onDeleted
}: {
  initial: PricingRow;
  index: number;
  onUpdated: (row: PricingRow) => void;
  onDeleted: (id: string) => void;
}) {
  const [basePrice, setBasePrice] = useState(initial.base_price.toString());
  const [perSqft, setPerSqft] = useState(initial.per_sqft.toString());
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [requiresInspection, setRequiresInspection] = useState(initial.requires_inspection);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const dirty =
    basePrice !== initial.base_price.toString() ||
    perSqft !== initial.per_sqft.toString() ||
    (notes ?? "") !== (initial.notes ?? "") ||
    requiresInspection !== initial.requires_inspection;

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await updatePricing(initial.id, {
        base_price: basePrice,
        per_sqft: perSqft,
        notes: notes.trim() === "" ? null : notes.trim(),
        requires_inspection: requiresInspection
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onUpdated({
        ...initial,
        base_price: Number(basePrice),
        per_sqft: Number(perSqft),
        notes: notes.trim() === "" ? null : notes.trim(),
        requires_inspection: requiresInspection
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    });
  };

  const remove = () => {
    setError(null);
    startTransition(async () => {
      const result = await deletePricing(initial.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDeleted(initial.id);
    });
  };

  return (
    <li
      className="animate-card-in grid gap-3 px-4 py-4 md:grid-cols-[1fr_auto] md:items-start md:gap-6 md:px-6"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-[1fr_1fr_auto]">
          <PriceField
            label="Base price"
            prefix="$"
            value={basePrice}
            onChange={setBasePrice}
          />
          <PriceField
            label="Per sq ft"
            value={perSqft}
            onChange={setPerSqft}
            step="0.0001"
          />
          <label className="col-span-2 md:col-span-1 flex items-center gap-2 md:pt-5">
            <input
              type="checkbox"
              checked={requiresInspection}
              onChange={(e) => setRequiresInspection(e.target.checked)}
              className="h-4 w-4 rounded-none border border-border bg-background text-primary accent-primary"
            />
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Inspection required
            </span>
          </label>
        </div>

        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Notes
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional — quarterly recurring, includes follow-up visit, etc."
            className="w-full border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
          />
        </div>

        {error && (
          <p className="font-mono text-[11px] text-destructive">{error}</p>
        )}
      </div>

      <div className="flex items-center gap-2 md:flex-col md:items-end md:gap-1.5">
        {dirty || saved ? (
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 border bg-background px-3 py-1.5 text-[12px] font-medium transition-colors",
              saved
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-border text-foreground hover:border-primary hover:bg-primary hover:text-primary-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              "disabled:cursor-not-allowed disabled:opacity-60"
            )}
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : saved ? (
              <Check className="h-3.5 w-3.5" />
            ) : null}
            {pending ? "Saving" : saved ? "Saved" : "Save"}
          </button>
        ) : null}

        {confirmingDelete ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="inline-flex items-center justify-center border border-destructive/60 bg-destructive/10 px-3 py-1.5 text-[12px] font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            aria-label="Delete rule"
            title="Delete rule"
            className="text-muted-foreground/70 transition-colors hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}

        {initial.requires_inspection && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-urgency-normal">
            <ShieldAlert className="h-3 w-3" />
            Quoted on-site
          </span>
        )}
      </div>
    </li>
  );
}

function AddRuleForm({
  onCancel,
  onCreated
}: {
  onCancel: () => void;
  onCreated: (row: PricingRow) => void;
}) {
  const [draft, setDraft] = useState<DraftRule>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createPricing({
        pest_type: draft.pest_type,
        base_price: draft.base_price,
        per_sqft: draft.per_sqft,
        notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
        requires_inspection: draft.requires_inspection
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onCreated({
        id: result.value.id,
        pest_type: draft.pest_type.trim().toLowerCase(),
        base_price: Number(draft.base_price),
        per_sqft: Number(draft.per_sqft),
        notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
        requires_inspection: draft.requires_inspection
      });
    });
  };

  return (
    <div className="border border-border bg-card p-5 md:p-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        New rule
      </p>
      <h3 className="mt-2 font-serif text-2xl text-ink">Add a pricing rule.</h3>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <FieldShell label="Pest type">
          <input
            type="text"
            placeholder="e.g. fleas"
            value={draft.pest_type}
            onChange={(e) => setDraft({ ...draft, pest_type: e.target.value })}
            className="w-full border border-border bg-background px-3 py-2 text-[13px] text-foreground focus:border-primary focus:outline-none"
          />
        </FieldShell>
        <FieldShell label="Base price">
          <div className="flex items-center border border-border bg-background pl-3 focus-within:border-primary">
            <span className="font-mono text-[13px] text-muted-foreground">$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={draft.base_price}
              onChange={(e) => setDraft({ ...draft, base_price: e.target.value })}
              className="w-full bg-transparent px-2 py-2 font-mono text-[13px] tabular-nums text-foreground focus:outline-none"
            />
          </div>
        </FieldShell>
        <FieldShell label="Per sq ft">
          <input
            type="number"
            step="0.0001"
            min="0"
            value={draft.per_sqft}
            onChange={(e) => setDraft({ ...draft, per_sqft: e.target.value })}
            className="w-full border border-border bg-background px-3 py-2 font-mono text-[13px] tabular-nums text-foreground focus:border-primary focus:outline-none"
          />
        </FieldShell>
        <FieldShell label="Notes (optional)" full>
          <input
            type="text"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="e.g. quarterly recurring, two follow-ups included"
            className="w-full border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
          />
        </FieldShell>
        <label className="md:col-span-2 flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.requires_inspection}
            onChange={(e) =>
              setDraft({ ...draft, requires_inspection: e.target.checked })
            }
            className="h-4 w-4 border border-border bg-background accent-primary"
          />
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Requires inspection (priced on-site)
          </span>
        </label>
      </div>

      {error && (
        <p className="mt-3 font-mono text-[11px] text-destructive">{error}</p>
      )}

      <div className="mt-5 flex items-center justify-end gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || draft.pest_type.trim() === ""}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 border border-border bg-background px-4 py-2 text-[13px] font-medium text-foreground transition-colors",
            "hover:border-primary hover:bg-primary hover:text-primary-foreground",
            "disabled:cursor-not-allowed disabled:opacity-60"
          )}
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Add rule
        </button>
      </div>
    </div>
  );
}

function FieldShell({
  label,
  full,
  children
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(full && "md:col-span-2")}>
      <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function PriceField({
  label,
  prefix,
  value,
  onChange,
  step = "0.01"
}: {
  label: string;
  prefix?: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <div>
      <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </label>
      <div
        className={cn(
          "flex items-center border border-border bg-background focus-within:border-primary",
          prefix ? "pl-3" : ""
        )}
      >
        {prefix && <span className="font-mono text-[13px] text-muted-foreground">{prefix}</span>}
        <input
          type="number"
          step={step}
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "w-full bg-transparent py-2 font-mono text-[13px] tabular-nums text-foreground focus:outline-none",
            prefix ? "px-2" : "px-3"
          )}
        />
      </div>
    </div>
  );
}

function groupByPest(rows: PricingRow[]): Array<{ pest_type: string; rules: PricingRow[] }> {
  const map = new Map<string, PricingRow[]>();
  for (const r of rows) {
    if (!map.has(r.pest_type)) map.set(r.pest_type, []);
    map.get(r.pest_type)!.push(r);
  }
  return Array.from(map.entries())
    .map(([pest_type, rules]) => ({ pest_type, rules }))
    .sort((a, b) => a.pest_type.localeCompare(b.pest_type));
}

function sortRows(rows: PricingRow[]): PricingRow[] {
  return [...rows].sort((a, b) => a.pest_type.localeCompare(b.pest_type));
}
