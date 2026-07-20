"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarCheck2,
  Contact,
  CreditCard,
  MapPin,
  Megaphone,
  MessageSquare,
  Phone,
  Plus,
  Search,
  Star,
  AlertTriangle,
  X
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/relative-time";
import { Badge } from "@/components/ui/badge";
import type { CustomerAcquisition } from "@/lib/supabase/types";
import { updateCustomerNotes, updateTags } from "./actions";

export type CustomerListItem = {
  id: string;
  phone: string;
  name: string | null;
  address: string | null;
  notes: string | null;
  opted_out: boolean;
  tags: string[];
  acquisition: CustomerAcquisition | null;
  created_at: string;
  visits: number;
  ltv: number;
  conversation_id: string | null;
};

export type TimelineEntry = {
  kind: "booking" | "escalation" | "payment" | "feedback";
  at: string;
  label: string;
  sub: string | null;
};

export function CustomersClient({
  initial,
  initialSelectedId,
  timeline
}: {
  initial: CustomerListItem[];
  initialSelectedId: string | null;
  timeline: TimelineEntry[];
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  const selectedId = search.get("id") ?? initialSelectedId;
  const selected = useMemo(
    () => initial.find((c) => c.id === selectedId) ?? null,
    [initial, selectedId]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return initial;
    return initial.filter((c) => {
      const name = c.name?.toLowerCase() ?? "";
      const phone = c.phone.toLowerCase();
      const tags = c.tags.join(" ");
      return name.includes(q) || phone.includes(q) || tags.includes(q);
    });
  }, [initial, query]);

  const select = useCallback(
    (id: string) => {
      const params = new URLSearchParams(search.toString());
      params.set("id", id);
      router.replace(`/admin/customers?${params.toString()}`, { scroll: false });
      setMobileOpen(true);
    },
    [router, search]
  );

  const clearSelection = useCallback(() => {
    const params = new URLSearchParams(search.toString());
    params.delete("id");
    const next = params.toString();
    router.replace(`/admin/customers${next ? `?${next}` : ""}`, { scroll: false });
    setMobileOpen(false);
  }, [router, search]);

  return (
    <div className="surface-paper min-h-dvh">
      <div className="mx-auto flex max-w-6xl flex-col px-5 py-10 md:px-10 md:py-14">
        <header>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            CRM · People
          </p>
          <h1 className="mt-3 font-serif text-[44px] leading-[1.02] tracking-tight text-ink md:text-[56px]">
            Customers.
          </h1>
          <p className="mt-3 text-base text-muted-foreground">
            {initial.length === 0
              ? "No customers yet."
              : `${initial.length} on file · lifetime value estimated from completed visits.`}
          </p>
        </header>

        <div className="mt-8 grid gap-6 md:grid-cols-[360px_1fr]">
          <aside
            className={cn(
              "flex flex-col border border-border bg-card",
              mobileOpen && "hidden md:flex"
            )}
          >
            <div className="border-b border-border p-3">
              <label className="relative block">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, phone, or tag…"
                  className="w-full border border-border bg-background py-2 pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
                />
              </label>
            </div>

            <ul className="max-h-[70dvh] overflow-y-auto">
              {filtered.length === 0 ? (
                <li className="p-6 text-center text-sm text-muted-foreground">
                  No customers match.
                </li>
              ) : (
                filtered.map((c) => (
                  <CustomerRow
                    key={c.id}
                    customer={c}
                    selected={c.id === selectedId}
                    onSelect={() => select(c.id)}
                  />
                ))
              )}
            </ul>
          </aside>

          <section
            className={cn(
              "border border-border bg-card",
              !mobileOpen && "hidden md:block",
              "min-h-[60dvh]"
            )}
          >
            {selected ? (
              <CustomerDetail customer={selected} timeline={timeline} onBack={clearSelection} />
            ) : (
              <DetailEmpty />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function CustomerRow({
  customer,
  selected,
  onSelect
}: {
  customer: CustomerListItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const name = customer.name?.trim() || null;
  return (
    <li className={cn("border-b border-border last:border-b-0", selected && "bg-accent/40")}>
      <button
        type="button"
        onClick={onSelect}
        className="block w-full px-4 py-3 text-left transition-colors hover:bg-accent/40 focus:bg-accent/40 focus:outline-none"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span
            className={cn(
              "truncate text-[14px] leading-tight text-ink",
              name ? "font-serif text-[16px]" : "font-mono"
            )}
          >
            {name ?? customer.phone}
          </span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
            {customer.visits > 0 ? `₹${customer.ltv} · ${customer.visits}v` : "new"}
          </span>
        </div>
        {name && (
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {customer.phone}
          </p>
        )}
        {customer.tags.length > 0 && (
          <p className="mt-1.5 flex flex-wrap gap-1">
            {customer.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="border border-border bg-background px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </p>
        )}
      </button>
    </li>
  );
}

function DetailEmpty() {
  return (
    <div className="flex h-full min-h-[60dvh] flex-col items-center justify-center px-8 py-16 text-center">
      <Contact aria-hidden="true" className="h-8 w-8 text-muted-foreground/40" />
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        No customer selected
      </p>
      <h2 className="mt-3 font-serif text-3xl italic text-ink">Pick one from the list.</h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Profile, tags, lifetime value, and the full history — bookings, escalations, payments,
        ratings — in one place.
      </p>
    </div>
  );
}

function CustomerDetail({
  customer,
  timeline,
  onBack
}: {
  customer: CustomerListItem;
  timeline: TimelineEntry[];
  onBack: () => void;
}) {
  const name = customer.name?.trim() || null;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-5 py-5 md:px-7 md:py-6">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to customer list"
            className="md:hidden -ml-1 mt-1 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h2
              className={cn(
                "leading-tight text-ink",
                name ? "font-serif text-3xl" : "font-mono text-xl"
              )}
            >
              {name ?? customer.phone}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Phone className="h-3 w-3" aria-hidden="true" />
                <span className="font-mono">{customer.phone}</span>
              </span>
              {customer.address && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3 w-3" aria-hidden="true" />
                  {customer.address}
                </span>
              )}
              <span className="text-muted-foreground/60">·</span>
              <span className="font-mono uppercase tracking-[0.12em]">
                Since <RelativeTime iso={customer.created_at} />
              </span>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="default">₹{customer.ltv} lifetime</Badge>
              <Badge variant="muted">
                {customer.visits} visit{customer.visits === 1 ? "" : "s"}
              </Badge>
              {customer.opted_out && <Badge variant="urgencyHigh">opted out</Badge>}
              {customer.acquisition && (
                <Badge variant="muted">
                  <Megaphone className="h-3 w-3" aria-hidden="true" />
                  {customer.acquisition.source_type ?? "ad"}
                  {customer.acquisition.headline ? ` · ${customer.acquisition.headline}` : ""}
                </Badge>
              )}
              {customer.conversation_id && (
                <Link
                  href={`/admin/conversations?id=${customer.conversation_id}`}
                  className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-primary hover:underline"
                >
                  <MessageSquare className="h-3 w-3" aria-hidden="true" />
                  Conversation
                </Link>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-6 md:px-7">
        <TagsEditor customerId={customer.id} initialTags={customer.tags} />
        <NotesEditor customerId={customer.id} initialNotes={customer.notes} />
        <Timeline entries={timeline} />
      </div>
    </div>
  );
}

function TagsEditor({ customerId, initialTags }: { customerId: string; initialTags: string[] }) {
  const router = useRouter();
  const [tags, setTags] = useState<string[]>(initialTags);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = useCallback(
    (next: string[]) => {
      setError(null);
      const prev = tags;
      setTags(next); // optimistic
      startTransition(async () => {
        const result = await updateTags(customerId, next);
        if (!result.ok) {
          setTags(prev);
          setError(result.error);
        } else {
          router.refresh();
        }
      });
    },
    [customerId, router, tags]
  );

  const add = useCallback(() => {
    const t = draft.trim().toLowerCase();
    if (!t || tags.includes(t)) return;
    setDraft("");
    save([...tags, t]);
  }, [draft, tags, save]);

  return (
    <section>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Tags · used by campaign segments
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 border border-border bg-background px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-foreground"
          >
            {t}
            <button
              type="button"
              aria-label={`Remove tag ${t}`}
              onClick={() => save(tags.filter((x) => x !== t))}
              disabled={pending}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="add tag…"
            className="w-28 border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            onClick={add}
            disabled={pending || draft.trim() === ""}
            aria-label="Add tag"
            className="border border-border bg-background p-1 text-muted-foreground hover:border-primary hover:text-foreground disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {error && <p className="mt-2 font-mono text-[11px] text-destructive">{error}</p>}
    </section>
  );
}

function NotesEditor({
  customerId,
  initialNotes
}: {
  customerId: string;
  initialNotes: string | null;
}) {
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const result = await updateCustomerNotes(customerId, notes);
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  }, [customerId, notes]);

  return (
    <section>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Notes
      </p>
      <textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        rows={3}
        placeholder="Gate code, pets, preferred technician…"
        className="w-full resize-y border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
      />
      <div className="mt-1.5 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || saved}
          className="border border-border bg-background px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving…" : saved ? "Saved" : "Save notes"}
        </button>
        {error && <p className="font-mono text-[11px] text-destructive">{error}</p>}
      </div>
    </section>
  );
}

const TIMELINE_ICONS = {
  booking: CalendarCheck2,
  escalation: AlertTriangle,
  payment: CreditCard,
  feedback: Star
} as const;

function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <section>
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        History · {entries.length === 0 ? "nothing yet" : `${entries.length} events`}
      </p>
      {entries.length === 0 ? (
        <p className="border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Bookings, escalations, payments, and ratings will show up here.
        </p>
      ) : (
        <ol className="space-y-0 border-l border-border pl-4">
          {entries.map((e, i) => {
            const Icon = TIMELINE_ICONS[e.kind];
            return (
              <li key={i} className="relative pb-4 last:pb-0">
                <span
                  className={cn(
                    "absolute -left-[22.5px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border bg-card",
                    e.kind === "escalation" ? "border-urgency-high" : "border-border"
                  )}
                >
                  <Icon className="h-2 w-2 text-muted-foreground" aria-hidden="true" />
                </span>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[13px] leading-snug text-foreground">{e.label}</p>
                  <RelativeTime
                    as="time"
                    iso={e.at}
                    className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
                  />
                </div>
                {e.sub && (
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{e.sub}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
