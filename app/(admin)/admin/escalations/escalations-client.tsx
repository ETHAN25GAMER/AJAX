"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, Phone, MapPin, CalendarCheck2, AlertOctagon, Inbox } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { formatSlotTime, shortDate } from "@/lib/time";
import { RelativeTime } from "@/components/relative-time";
import { resolveEscalation } from "./actions";
import type { Urgency } from "@/lib/supabase/types";

export type EscalationWithCustomer = {
  id: string;
  customer_id: string;
  summary: string;
  urgency: Urgency;
  resolved: boolean;
  created_at: string;
  customer: {
    id: string;
    phone: string;
    name: string | null;
    address: string | null;
  } | null;
  last_booking: {
    customer_id: string;
    confirmation_code: string;
    pest_type: string;
    slot_start: string;
    status: string;
  } | null;
};


type Filter = "all" | "high" | "normal" | "low";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "high", label: "High" },
  { id: "normal", label: "Normal" },
  { id: "low", label: "Low" }
];

const URGENCY_ORDER: Record<Urgency, number> = { high: 0, normal: 1, low: 2 };

export function EscalationsClient({ initial }: { initial: EscalationWithCustomer[] }) {
  const [escalations, setEscalations] = useState<EscalationWithCustomer[]>(() =>
    sortEscalations(initial)
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());
  const supabaseRef = useRef<ReturnType<typeof createSupabaseBrowserClient> | null>(null);
  const channelRef = useRef<ReturnType<NonNullable<typeof supabaseRef.current>["channel"]> | null>(null);

  if (!supabaseRef.current) supabaseRef.current = createSupabaseBrowserClient();

  // Supabase Realtime: prepend new escalations as they arrive; drop any that
  // got resolved elsewhere (e.g. another admin in another tab).
  useEffect(() => {
    const supabase = supabaseRef.current!;
    let cancelled = false;

    (async () => {
      // RLS on the realtime stream uses the user's JWT, not the anon key.
      // Pass the access token to the realtime client before subscribing so
      // postgres_changes events that match admin policies are delivered.
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) supabase.realtime.setAuth(token);
      if (cancelled) return;

      const channel = supabase
        .channel("escalations-inbox")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "escalations" },
          async (payload) => {
            const next = payload.new as { id: string; customer_id: string };
            const { data: customer } = await supabase
              .from("customers")
              .select("id, phone, name, address")
              .eq("id", next.customer_id)
              .maybeSingle();
            const row = payload.new as EscalationWithCustomer & { resolved: boolean };
            if (row.resolved) return;
            setEscalations((prev) =>
              sortEscalations([
                ...prev.filter((e) => e.id !== row.id),
                { ...row, customer: customer ?? null, last_booking: null }
              ])
            );
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "escalations" },
          (payload) => {
            const next = payload.new as { id: string; resolved: boolean };
            if (next.resolved) {
              setEscalations((prev) => prev.filter((e) => e.id !== next.id));
            }
          }
        )
        .subscribe();

      channelRef.current = channel;
    })();

    return () => {
      cancelled = true;
      const ch = channelRef.current;
      if (ch) {
        supabaseRef.current?.removeChannel(ch);
        channelRef.current = null;
      }
    };
  }, []);

  const visible = useMemo(
    () => (filter === "all" ? escalations : escalations.filter((e) => e.urgency === filter)),
    [escalations, filter]
  );

  const counts = useMemo(() => {
    const c = { all: escalations.length, high: 0, normal: 0, low: 0 };
    for (const e of escalations) c[e.urgency]++;
    return c;
  }, [escalations]);

  return (
    <div className="surface-paper min-h-dvh">
      <div className="mx-auto max-w-3xl px-5 py-10 md:px-10 md:py-14">
        <Header counts={counts} filter={filter} setFilter={setFilter} />

        <div className="mt-10">
          {visible.length === 0 ? (
            <EmptyState filtered={filter !== "all" && escalations.length > 0} />
          ) : (
            <ul className="space-y-5">
              {visible.map((e, i) => (
                <EscalationItem
                  key={e.id}
                  escalation={e}
                  index={i}
                  isResolving={resolvingIds.has(e.id)}
                  onResolve={(id) => {
                    setResolvingIds((s) => new Set(s).add(id));
                    setTimeout(() => {
                      setEscalations((prev) => prev.filter((x) => x.id !== id));
                      setResolvingIds((s) => {
                        const n = new Set(s);
                        n.delete(id);
                        return n;
                      });
                    }, 360);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Header({
  counts,
  filter,
  setFilter
}: {
  counts: { all: number; high: number; normal: number; low: number };
  filter: Filter;
  setFilter: (f: Filter) => void;
}) {
  const openLabel = (() => {
    if (counts.all === 0) return "Nothing open";
    if (counts.all === 1) return "One open";
    if (counts.high > 0) {
      const word = counts.high === 1 ? "needs" : "need";
      return `${counts.all} open · ${counts.high} ${word} immediate attention`;
    }
    return `${counts.all} open`;
  })();

  return (
    <header>
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Triage · Inbox
        </p>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Live
          <span className="ml-1.5 inline-block h-1.5 w-1.5 translate-y-[-1px] rounded-full bg-primary align-middle animate-pulse-bar" />
        </span>
      </div>

      <h1 className="mt-3 font-serif text-[44px] leading-[1.02] tracking-tight text-ink md:text-[56px]">
        Escalations.
      </h1>

      <p
        className={cn(
          "mt-3 text-base text-muted-foreground",
          counts.high > 0 && "text-urgency-high"
        )}
      >
        {counts.high > 0 && <AlertOctagon className="mr-2 inline h-4 w-4 -translate-y-px" />}
        {openLabel}
      </p>

      <div
        role="tablist"
        aria-label="Filter by urgency"
        className="mt-7 flex flex-wrap gap-1.5 border-t border-border pt-4"
      >
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
                "group inline-flex items-center gap-2 px-3 py-1.5 text-[12px] font-medium tracking-tight transition-colors",
                "border border-transparent",
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
  );
}

function EscalationItem({
  escalation,
  index,
  isResolving,
  onResolve
}: {
  escalation: EscalationWithCustomer;
  index: number;
  isResolving: boolean;
  onResolve: (id: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const headline = escalation.customer?.name?.trim() || "Unknown customer";
  const phone = escalation.customer?.phone ?? "—";
  const address = escalation.customer?.address?.trim() ?? null;

  const submit = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const result = await resolveEscalation(escalation.id);
      if (result.ok) {
        onResolve(escalation.id);
      } else {
        setError(result.error);
      }
    });
  }, [escalation.id, onResolve]);

  const urgencyBar = cn(
    "absolute inset-y-0 left-0 w-[3px] md:w-[4px]",
    escalation.urgency === "high" && "bg-urgency-high animate-pulse-bar",
    escalation.urgency === "normal" && "bg-urgency-normal",
    escalation.urgency === "low" && "bg-urgency-low/60"
  );

  const urgencyVariant =
    escalation.urgency === "high"
      ? "urgencyHigh"
      : escalation.urgency === "normal"
      ? "urgencyNormal"
      : "urgencyLow";

  return (
    <li
      className={cn(
        "relative overflow-hidden border border-border bg-card pl-4 transition-all duration-300 md:pl-6",
        "animate-card-in",
        isResolving && "animate-card-out pointer-events-none"
      )}
      style={{ ["--index" as string]: index, animationDelay: `${index * 60}ms` }}
    >
      <span className={urgencyBar} aria-hidden="true" />

      <div className="flex flex-col gap-4 px-5 py-5 md:flex-row md:items-start md:gap-8 md:px-6 md:py-6">
        <div className="flex-1">
          <div className="flex items-center justify-between gap-3">
            <Badge variant={urgencyVariant}>
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  escalation.urgency === "high" && "bg-urgency-high",
                  escalation.urgency === "normal" && "bg-urgency-normal",
                  escalation.urgency === "low" && "bg-urgency-low"
                )}
              />
              Escalation · {escalation.urgency}
            </Badge>
            <RelativeTime
              as="time"
              iso={escalation.created_at}
              className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground"
            />
          </div>

          <h2 className="mt-3 font-serif text-2xl leading-tight text-ink md:text-[28px]">
            {headline}
          </h2>

          <dl className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            <div className="inline-flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" aria-hidden="true" />
              <dt className="sr-only">Phone</dt>
              <dd className="font-mono">{phone}</dd>
            </div>
            {address && (
              <div className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                <dt className="sr-only">Address</dt>
                <dd>{address}</dd>
              </div>
            )}
          </dl>

          <p className="mt-4 max-w-prose text-[15px] leading-relaxed text-foreground/90">
            {escalation.summary}
          </p>

          <LastBooking booking={escalation.last_booking} />

          {error && (
            <p className="mt-3 font-mono text-[11px] text-destructive">{error}</p>
          )}
        </div>

        <div className="flex shrink-0 items-stretch md:flex-col md:items-end md:gap-2">
          <ResolveButton onClick={submit} pending={pending || isResolving} />
        </div>
      </div>
    </li>
  );
}

function LastBooking({ booking }: { booking: EscalationWithCustomer["last_booking"] }) {
  if (!booking) {
    return (
      <p className="mt-4 inline-flex items-center gap-2 border-t border-border/70 pt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground/80">
        <CalendarCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
        No previous booking
      </p>
    );
  }
  const dateLabel = shortDate(booking.slot_start);
  const timeLabel = formatSlotTime(booking.slot_start);

  return (
    <p className="mt-4 inline-flex items-center gap-2 border-t border-border/70 pt-3 text-[12px] text-muted-foreground">
      <CalendarCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="font-mono uppercase tracking-[0.12em]">{booking.confirmation_code}</span>
      <span className="text-muted-foreground/60">·</span>
      <span>{booking.pest_type}</span>
      <span className="text-muted-foreground/60">·</span>
      <span>
        {dateLabel}, {timeLabel}
      </span>
      <span className="text-muted-foreground/60">·</span>
      <span className="font-mono uppercase tracking-[0.12em]">{booking.status}</span>
    </p>
  );
}

function ResolveButton({ onClick, pending }: { onClick: () => void; pending: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={cn(
        "group relative inline-flex items-center justify-center gap-2 overflow-hidden border border-border bg-background px-4 py-2 text-[13px] font-medium text-foreground transition-colors",
        "hover:border-primary hover:bg-primary hover:text-primary-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-60"
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -translate-x-full bg-primary/15 group-hover:animate-ribbon-sweep"
      />
      <Check className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="relative">{pending ? "Resolving…" : "Mark resolved"}</span>
    </button>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  if (filtered) {
    return (
      <div className="border border-dashed border-border px-8 py-16 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          No matches
        </p>
        <p className="mt-3 font-serif text-2xl text-ink">Nothing under this filter.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          There are open escalations — try a different urgency.
        </p>
      </div>
    );
  }

  return (
    <div className="relative isolate overflow-hidden border border-border bg-card px-8 py-20 text-center md:py-24">
      <SproutMark />
      <p className="relative font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        <Inbox className="mr-1.5 inline h-3 w-3 -translate-y-px" />
        Inbox empty
      </p>
      <h2 className="relative mt-5 font-serif text-4xl italic leading-tight text-ink md:text-5xl">
        All clear.
      </h2>
      <p className="relative mx-auto mt-4 max-w-sm text-[14px] text-muted-foreground">
        Nothing needs your attention right now. The agent is handling things on its own.
      </p>
      <LastCheckedStamp />
    </div>
  );
}

// Client-only timestamp — rendering `new Date()` during SSR causes a hydration
// mismatch when the second ticks over between server render and client hydration.
function LastCheckedStamp() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const fmt = () =>
      new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    setNow(fmt());
    const id = setInterval(() => setNow(fmt()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <p
      className="relative mt-8 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70"
      suppressHydrationWarning
    >
      Last checked · {now ?? "—"}
    </p>
  );
}

function SproutMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 120 120"
      className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-[55%] opacity-[0.06]"
    >
      <defs>
        <radialGradient id="sproutGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="hsl(var(--primary))" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="56" fill="url(#sproutGrad)" />
      <path
        d="M60 96 V58 M60 58 C42 56 36 42 38 26 C54 26 64 38 60 58 Z M60 58 C78 56 84 42 82 26 C66 26 56 38 60 58 Z"
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function sortEscalations(items: EscalationWithCustomer[]): EscalationWithCustomer[] {
  return [...items].sort((a, b) => {
    const u = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
    if (u !== 0) return u;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}
