"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, FileClock, Plus, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { shortDate } from "@/lib/time";
import { createAmc, markCancelled, markRenewed, reactivate } from "./actions";
import type { AmcStatus } from "@/lib/supabase/types";

export type AmcRow = {
  customer_id: string;
  commenced_at: string;
  renews_at: string;
  lead_days: number;
  pest_type: string;
  annual_price: number | null;
  status: AmcStatus;
  reminder_sent_at: string | null;
  followup_sent_at: string | null;
  notes: string | null;
  customer: { name: string | null; phone: string } | null;
};

export type CustomerOption = {
  id: string;
  label: string;
  phone: string;
  has_amc: boolean;
};

type Filter = "all" | AmcStatus | "expiring";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "expiring", label: "Expiring soon" },
  { id: "pending_renewal", label: "Pending" },
  { id: "expired", label: "Expired" },
  { id: "cancelled", label: "Cancelled" }
];

export function AmcClient({
  initial,
  customers
}: {
  initial: AmcRow[];
  customers: CustomerOption[];
}) {
  const [rows, setRows] = useState<AmcRow[]>(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [addOpen, setAddOpen] = useState(false);

  const visible = useMemo(() => filtered(rows, filter), [rows, filter]);
  const counts = useMemo(() => countByFilter(rows), [rows]);

  return (
    <div className="surface-paper min-h-dvh">
      <div className="mx-auto max-w-5xl px-5 py-10 md:px-10 md:py-14">
        <header>
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Recurring · Contracts
            </p>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 border border-border bg-card px-3 py-1.5 text-[12px] text-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <Plus className="h-3.5 w-3.5" />
              Add AMC
            </button>
          </div>
          <h1 className="mt-3 font-serif text-[44px] leading-[1.02] tracking-tight text-ink md:text-[56px]">
            AMC.
          </h1>
          <p className="mt-3 text-base text-muted-foreground">
            <FileClock className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px" />
            {counts.all === 0
              ? "No contracts on file yet."
              : `${counts.active} active · ${counts.expiring} expiring within ${EXPIRING_DAYS} days.`}
          </p>

          <div role="tablist" className="mt-7 flex flex-wrap gap-1.5 border-t border-border pt-4">
            {FILTERS.map(({ id, label }) => {
              const n = counts[id];
              const selected = filter === id;
              return (
                <button
                  key={id}
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setFilter(id)}
                  className={cn(
                    "inline-flex items-center gap-2 px-3 py-1.5 text-[12px] font-medium tracking-tight transition-colors border border-transparent",
                    selected
                      ? "border-border bg-card text-foreground shadow-[0_1px_0_0_hsl(var(--border))]"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                  <span
                    className={cn(
                      "font-mono text-[10px] tabular-nums",
                      selected ? "text-foreground/60" : "text-muted-foreground/70"
                    )}
                  >
                    {n}
                  </span>
                </button>
              );
            })}
          </div>
        </header>

        <div className="mt-10">
          {visible.length === 0 ? (
            <EmptyState filtered={filter !== "all"} />
          ) : (
            <ul className="space-y-3">
              {visible.map((r) => (
                <li key={r.customer_id}>
                  <ContractRow row={r} onMutated={(next) => setRows((prev) => upsertRow(prev, next))} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {addOpen && (
        <AddDialog
          customers={customers}
          onClose={() => setAddOpen(false)}
          onCreated={(row) => {
            setRows((prev) => upsertRow(prev, row));
            setAddOpen(false);
          }}
        />
      )}
    </div>
  );
}

const EXPIRING_DAYS = 30;

function ContractRow({
  row,
  onMutated
}: {
  row: AmcRow;
  onMutated: (next: AmcRow | { customer_id: string; status: AmcStatus; renews_at?: string }) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const headline = row.customer?.name?.trim() || "Unknown customer";
  const phone = row.customer?.phone ?? "—";
  const expiringSoon =
    row.status === "active" && daysUntil(row.renews_at) <= EXPIRING_DAYS;

  const callRenew = () => {
    setError(null);
    startTransition(async () => {
      const result = await markRenewed(row.customer_id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const next = nextRenews(row.renews_at);
      onMutated({
        ...row,
        renews_at: next,
        status: "active",
        reminder_sent_at: null,
        followup_sent_at: null
      });
    });
  };

  const callCancel = () => {
    if (!window.confirm("Mark this contract cancelled?")) return;
    setError(null);
    startTransition(async () => {
      const result = await markCancelled(row.customer_id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onMutated({ ...row, status: "cancelled" });
    });
  };

  const callReactivate = () => {
    setError(null);
    startTransition(async () => {
      const result = await reactivate(row.customer_id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onMutated({ ...row, status: "active" });
    });
  };

  return (
    <div className="relative grid grid-cols-1 gap-3 border border-border bg-card px-5 py-4 md:grid-cols-[1fr_auto] md:items-center md:gap-6 md:px-6">
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-0 w-[3px]",
          row.status === "active" && expiringSoon && "bg-urgency-normal",
          row.status === "active" && !expiringSoon && "bg-primary",
          row.status === "pending_renewal" && "bg-urgency-normal",
          row.status === "cancelled" && "bg-destructive/60",
          row.status === "expired" && "bg-muted-foreground/40"
        )}
      />

      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="truncate font-serif text-[22px] leading-tight text-ink">{headline}</h3>
          <StatusBadge status={row.status} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          <span>{row.pest_type}</span>
          {row.annual_price != null && (
            <>
              <span className="text-muted-foreground/60">·</span>
              <span className="font-mono tabular-nums">${row.annual_price.toFixed(0)}/yr</span>
            </>
          )}
          <span className="text-muted-foreground/60">·</span>
          <span className="font-mono">{phone}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <span>Renews {shortDate(row.renews_at + "T00:00:00Z")}</span>
          <span className="text-muted-foreground/60">·</span>
          <span>Lead {row.lead_days}d</span>
          {row.reminder_sent_at && (
            <>
              <span className="text-muted-foreground/60">·</span>
              <span>Reminded</span>
            </>
          )}
          {row.followup_sent_at && (
            <>
              <span className="text-muted-foreground/60">·</span>
              <span>Followup sent</span>
            </>
          )}
        </div>
        {error && <p className="mt-2 font-mono text-[11px] text-destructive">{error}</p>}
      </div>

      <div className="flex flex-wrap items-stretch gap-2">
        {row.status === "cancelled" || row.status === "expired" ? (
          <button
            type="button"
            onClick={callReactivate}
            disabled={pending}
            className="inline-flex items-center gap-1.5 border border-border bg-background px-3 py-2 text-[12px] text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reactivate
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={callRenew}
              disabled={pending}
              className="inline-flex items-center gap-1.5 border border-primary bg-transparent px-3 py-2 text-[12px] text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
            >
              <Check className="h-3.5 w-3.5" />
              Mark renewed
            </button>
            <button
              type="button"
              onClick={callCancel}
              disabled={pending}
              className="inline-flex items-center gap-1.5 border border-border bg-background px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-60"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: AmcStatus }) {
  const map: Record<AmcStatus, { label: string; tone: string }> = {
    active: { label: "Active", tone: "text-primary" },
    pending_renewal: { label: "Pending", tone: "text-urgency-normal" },
    cancelled: { label: "Cancelled", tone: "text-destructive" },
    expired: { label: "Expired", tone: "text-muted-foreground" }
  };
  const { label, tone } = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em]",
        tone
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function AddDialog({
  customers,
  onClose,
  onCreated
}: {
  customers: CustomerOption[];
  onClose: () => void;
  onCreated: (row: AmcRow) => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [commencedAt, setCommencedAt] = useState(todayISO());
  const [renewsAt, setRenewsAt] = useState(oneYearFromNowISO());
  const [leadDays, setLeadDays] = useState(30);
  const [pestType, setPestType] = useState("general pest");
  const [annualPrice, setAnnualPrice] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const eligibleCustomers = customers.filter((c) => !c.has_amc);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createAmc({
        customer_id: customerId,
        commenced_at: commencedAt,
        renews_at: renewsAt,
        lead_days: leadDays,
        pest_type: pestType,
        annual_price: annualPrice.trim() === "" ? null : annualPrice
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const cust = customers.find((c) => c.id === customerId);
      onCreated({
        customer_id: customerId,
        commenced_at: commencedAt,
        renews_at: renewsAt,
        lead_days: leadDays,
        pest_type: pestType,
        annual_price: annualPrice.trim() === "" ? null : Number(annualPrice),
        status: "active",
        reminder_sent_at: null,
        followup_sent_at: null,
        notes: null,
        customer: cust ? { name: cust.label.split(" · ")[0], phone: cust.phone } : null
      });
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md border border-border bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Add contract
        </p>
        <h2 className="mt-2 font-serif text-2xl text-ink">New AMC.</h2>

        <div className="mt-5 space-y-3">
          <Field label="Customer">
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Select…</option>
              {eligibleCustomers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Commenced">
              <input
                type="date"
                value={commencedAt}
                onChange={(e) => setCommencedAt(e.target.value)}
                className="w-full border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </Field>
            <Field label="Renews on">
              <input
                type="date"
                value={renewsAt}
                onChange={(e) => setRenewsAt(e.target.value)}
                className="w-full border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lead days">
              <input
                type="number"
                value={leadDays}
                min={1}
                max={365}
                onChange={(e) => setLeadDays(Number(e.target.value))}
                className="w-full border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </Field>
            <Field label="Annual price">
              <input
                type="number"
                value={annualPrice}
                onChange={(e) => setAnnualPrice(e.target.value)}
                placeholder="optional"
                className="w-full border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </Field>
          </div>
          <Field label="Pest type">
            <input
              type="text"
              value={pestType}
              onChange={(e) => setPestType(e.target.value)}
              className="w-full border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>
        </div>

        {error && <p className="mt-3 font-mono text-[11px] text-destructive">{error}</p>}

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending || !customerId}
            className="inline-flex flex-1 items-center justify-center gap-2 border border-primary bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground transition-colors disabled:opacity-50"
          >
            {pending ? "Creating…" : "Create"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="border border-border bg-background px-4 py-2.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="border border-dashed border-border bg-card px-8 py-16 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {filtered ? "No matches" : "No contracts yet"}
      </p>
      <p className="mt-3 font-serif text-2xl text-ink">
        {filtered ? "Nothing under this filter." : "Add your first AMC."}
      </p>
    </div>
  );
}

function filtered(rows: AmcRow[], filter: Filter): AmcRow[] {
  if (filter === "all") return rows;
  if (filter === "expiring") {
    return rows.filter((r) => r.status === "active" && daysUntil(r.renews_at) <= EXPIRING_DAYS);
  }
  return rows.filter((r) => r.status === filter);
}

function countByFilter(rows: AmcRow[]): Record<Filter, number> {
  const c: Record<Filter, number> = {
    all: rows.length,
    active: 0,
    expiring: 0,
    pending_renewal: 0,
    expired: 0,
    cancelled: 0
  };
  for (const r of rows) {
    c[r.status]++;
    if (r.status === "active" && daysUntil(r.renews_at) <= EXPIRING_DAYS) c.expiring++;
  }
  return c;
}

function daysUntil(dateStr: string): number {
  const now = new Date();
  const target = new Date(dateStr + "T00:00:00Z");
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

function nextRenews(current: string): string {
  const d = new Date(current + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function upsertRow(
  prev: AmcRow[],
  next: AmcRow | { customer_id: string; status: AmcStatus; renews_at?: string }
): AmcRow[] {
  const idx = prev.findIndex((r) => r.customer_id === next.customer_id);
  if (idx < 0) return [...prev, next as AmcRow].sort((a, b) => a.renews_at.localeCompare(b.renews_at));
  const merged: AmcRow = { ...prev[idx], ...next } as AmcRow;
  const copy = [...prev];
  copy[idx] = merged;
  return copy.sort((a, b) => a.renews_at.localeCompare(b.renews_at));
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function oneYearFromNowISO(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}
