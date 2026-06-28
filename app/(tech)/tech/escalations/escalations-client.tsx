"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertOctagon, ChevronRight, Inbox, Phone } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/relative-time";
import type { Urgency } from "@/lib/supabase/types";

export type TechEscalation = {
  id: string;
  customer_id: string;
  summary: string;
  urgency: Urgency;
  created_at: string;
  customer: {
    id: string;
    phone: string;
    name: string | null;
  } | null;
  linked_job: {
    customer_id: string;
    id: string;
    confirmation_code: string;
  } | null;
};

const URGENCY_ORDER: Record<Urgency, number> = { high: 0, normal: 1, low: 2 };

export function TechEscalationsClient({
  initial,
  technicianId
}: {
  initial: TechEscalation[];
  technicianId: string;
}) {
  const [escalations, setEscalations] = useState<TechEscalation[]>(() => sortEscalations(initial));
  const supabaseRef = useRef<ReturnType<typeof createSupabaseBrowserClient> | null>(null);
  const channelRef = useRef<ReturnType<NonNullable<typeof supabaseRef.current>["channel"]> | null>(
    null
  );

  if (!supabaseRef.current) supabaseRef.current = createSupabaseBrowserClient();

  useEffect(() => {
    const supabase = supabaseRef.current!;
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) supabase.realtime.setAuth(token);
      if (cancelled) return;

      const channel = supabase
        .channel(`tech-alerts-${technicianId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "escalations" },
          async (payload) => {
            const row = payload.new as {
              id: string;
              customer_id: string;
              summary: string;
              urgency: Urgency;
              created_at: string;
              resolved: boolean;
            };
            if (row.resolved) return;

            const [{ data: customer }, { data: linked }] = await Promise.all([
              supabase
                .from("customers")
                .select("id, phone, name")
                .eq("id", row.customer_id)
                .maybeSingle(),
              supabase
                .from("appointments")
                .select("id, customer_id, confirmation_code")
                .eq("customer_id", row.customer_id)
                .eq("assigned_technician_id", technicianId)
                .order("slot_start", { ascending: false })
                .limit(1)
                .maybeSingle()
            ]);

            setEscalations((prev) =>
              sortEscalations([
                ...prev.filter((e) => e.id !== row.id),
                {
                  id: row.id,
                  customer_id: row.customer_id,
                  summary: row.summary,
                  urgency: row.urgency,
                  created_at: row.created_at,
                  customer: customer ?? null,
                  linked_job: linked ?? null
                }
              ])
            );
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "escalations" },
          (payload) => {
            const row = payload.new as { id: string; resolved: boolean };
            if (row.resolved) {
              setEscalations((prev) => prev.filter((e) => e.id !== row.id));
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
  }, [technicianId]);

  const counts = useMemo(() => {
    const c = { all: escalations.length, high: 0, normal: 0, low: 0 };
    for (const e of escalations) c[e.urgency]++;
    return c;
  }, [escalations]);

  const lead = (() => {
    if (counts.all === 0) return "Nothing flagged on your jobs.";
    if (counts.high > 0) {
      const word = counts.high === 1 ? "needs" : "need";
      return `${counts.all} open · ${counts.high} ${word} attention now.`;
    }
    return `${counts.all} ${counts.all === 1 ? "alert" : "alerts"} on your route.`;
  })();

  return (
    <div className="surface-paper min-h-dvh">
      <div className="mx-auto max-w-md px-5 pb-6 pt-8">
        <header>
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Triage · Your customers
            </p>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Live
              <span className="ml-1.5 inline-block h-1.5 w-1.5 translate-y-[-1px] rounded-full bg-primary align-middle animate-pulse-bar" />
            </span>
          </div>

          <h1 className="mt-3 font-serif text-[44px] leading-[1.02] tracking-tight text-ink">
            Alerts.
          </h1>

          <p
            className={cn(
              "mt-3 text-[14px] text-muted-foreground",
              counts.high > 0 && "text-urgency-high"
            )}
          >
            {counts.high > 0 && (
              <AlertOctagon className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px" />
            )}
            {lead}
          </p>
        </header>

        <div className="mt-7">
          {escalations.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="space-y-3">
              {escalations.map((e, i) => (
                <li key={e.id}>
                  <AlertCard escalation={e} index={i} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function AlertCard({ escalation, index }: { escalation: TechEscalation; index: number }) {
  const headline = escalation.customer?.name?.trim() || "Unknown customer";
  const phone = escalation.customer?.phone ?? "—";
  const linked = escalation.linked_job;

  const Inner = (
    <div
      className={cn(
        "relative grid grid-cols-[auto_1fr_auto] items-stretch gap-x-3 border border-border bg-card px-4 py-4 transition-colors",
        "animate-card-in",
        linked && "active:bg-card/70"
      )}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-0 w-[3px]",
          escalation.urgency === "high" && "bg-urgency-high animate-pulse-bar",
          escalation.urgency === "normal" && "bg-urgency-normal",
          escalation.urgency === "low" && "bg-urgency-low/60"
        )}
      />

      <UrgencyDot urgency={escalation.urgency} />

      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate font-serif text-[18px] leading-tight text-ink">{headline}</h3>
          <RelativeTime
            as="time"
            iso={escalation.created_at}
            className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
          />
        </div>
        <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-foreground/90">
          {escalation.summary}
        </p>
        <div className="mt-2.5 flex items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Phone className="h-3 w-3" />
            <span>{phone}</span>
          </span>
          {linked && <span>Job · {linked.confirmation_code}</span>}
        </div>
      </div>

      {linked && (
        <ChevronRight className="h-4 w-4 self-center text-muted-foreground/40" aria-hidden="true" />
      )}
    </div>
  );

  if (!linked) return Inner;

  return (
    <Link
      href={`/tech/jobs/${linked.id}`}
      className="block focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
    >
      {Inner}
    </Link>
  );
}

function UrgencyDot({ urgency }: { urgency: Urgency }) {
  return (
    <span
      aria-label={`${urgency} urgency`}
      className={cn(
        "mt-1 inline-block h-2 w-2 rounded-full",
        urgency === "high" && "bg-urgency-high animate-pulse-bar",
        urgency === "normal" && "bg-urgency-normal",
        urgency === "low" && "bg-urgency-low/70"
      )}
    />
  );
}

function EmptyState() {
  return (
    <div className="relative isolate overflow-hidden border border-border bg-card px-6 py-16 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        <Inbox className="mr-1.5 inline h-3 w-3 -translate-y-px" />
        Nothing flagged
      </p>
      <h2 className="mt-4 font-serif text-[28px] italic leading-tight text-ink">All clear.</h2>
      <p className="mx-auto mt-3 max-w-xs text-[13px] text-muted-foreground">
        Dispatch will surface anything urgent on your customers here.
      </p>
    </div>
  );
}

function sortEscalations(items: TechEscalation[]): TechEscalation[] {
  return [...items].sort((a, b) => {
    const u = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
    if (u !== 0) return u;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}
