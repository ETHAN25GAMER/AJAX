"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, CalendarOff, ChevronRight, MapPin } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { dayHeader, dayKey, formatSlotTime } from "@/lib/time";
import type { AppointmentStatus } from "@/lib/supabase/types";

export type AssignedAppointment = {
  id: string;
  customer_id: string;
  confirmation_code: string;
  pest_type: string;
  slot_start: string;
  slot_end: string;
  status: AppointmentStatus;
  completed_at: string | null;
  customer: {
    id: string;
    name: string | null;
    address: string | null;
  } | null;
};

type RealtimeAppointmentRow = Omit<AssignedAppointment, "customer"> & {
  assigned_technician_id: string | null;
};

export function TodayClient({
  initial,
  technicianId,
  technicianName
}: {
  initial: AssignedAppointment[];
  technicianId: string;
  technicianName: string | null;
}) {
  const [appointments, setAppointments] = useState<AssignedAppointment[]>(initial);
  const appointmentsRef = useRef<AssignedAppointment[]>(initial);
  appointmentsRef.current = appointments;
  const supabaseRef = useRef<ReturnType<typeof createSupabaseBrowserClient> | null>(null);
  const channelRef = useRef<ReturnType<NonNullable<typeof supabaseRef.current>["channel"]> | null>(
    null
  );

  if (!supabaseRef.current) supabaseRef.current = createSupabaseBrowserClient();

  // Realtime: pick up new assignments and react to admin edits. Caveat: when an
  // admin reassigns a job away from this tech, RLS on the UPDATE's new row blocks
  // the broadcast, so the row will linger until the next page load. Reassignment
  // *to* this tech arrives fine, as does any in-place edit on a kept job.
  useEffect(() => {
    const supabase = supabaseRef.current!;
    let cancelled = false;

    (async () => {
      // Realtime is an enhancement on top of the server-rendered list, so a
      // flaky network / token refresh ("Failed to fetch" from getSession) must
      // never bubble as an unhandled rejection — degrade to "no live updates".
      // setAuth before subscribe so the channel authorizes against RLS.
      let token: string | undefined;
      for (let attempt = 0; attempt < 2 && !cancelled; attempt++) {
        try {
          const { data } = await supabase.auth.getSession();
          token = data.session?.access_token;
          break;
        } catch (err) {
          if (attempt === 1) {
            console.warn("[tech/today] realtime auth unavailable, skipping live updates", err);
            return;
          }
          await new Promise((r) => setTimeout(r, 800));
        }
      }
      if (cancelled) return;
      if (token) supabase.realtime.setAuth(token);

      const channel = supabase
        .channel(`tech-route-${technicianId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "appointments" },
          async (payload) => {
            const row = payload.new as RealtimeAppointmentRow;
            if (row.assigned_technician_id !== technicianId) return;
            const { data: customer } = await supabase
              .from("customers")
              .select("id, name, address")
              .eq("id", row.customer_id)
              .maybeSingle();
            setAppointments((prev) =>
              sortByTime([
                ...prev.filter((a) => a.id !== row.id),
                { ...stripAssignment(row), customer: customer ?? null }
              ])
            );
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "appointments" },
          async (payload) => {
            const row = payload.new as RealtimeAppointmentRow;
            // Reassigned away — drop from view.
            if (row.assigned_technician_id !== technicianId) {
              setAppointments((prev) => prev.filter((a) => a.id !== row.id));
              return;
            }
            // Already have it — patch in place, preserve the customer join.
            if (appointmentsRef.current.some((a) => a.id === row.id)) {
              setAppointments((prev) =>
                prev.map((a) =>
                  a.id === row.id ? { ...a, ...stripAssignment(row), customer: a.customer } : a
                )
              );
              return;
            }
            // Newly assigned to us via update — fetch customer and insert.
            const { data: customer } = await supabase
              .from("customers")
              .select("id, name, address")
              .eq("id", row.customer_id)
              .maybeSingle();
            setAppointments((prev) =>
              sortByTime([
                ...prev.filter((a) => a.id !== row.id),
                { ...stripAssignment(row), customer: customer ?? null }
              ])
            );
          }
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "appointments" },
          (payload) => {
            const row = payload.old as { id: string };
            setAppointments((prev) => prev.filter((a) => a.id !== row.id));
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

  const groups = useMemo(() => groupByDay(appointments), [appointments]);
  const total = appointments.length;
  const remaining = useMemo(
    () => appointments.filter((a) => a.status === "booked").length,
    [appointments]
  );

  return (
    <div className="surface-paper min-h-dvh">
      <div className="mx-auto max-w-md px-5 pb-6 pt-8">
        <header>
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Your route · Today & tomorrow
            </p>
          </div>

          <h1 className="mt-3 font-serif text-[44px] leading-[1.02] tracking-tight text-ink">
            Today.
          </h1>

          <p className="mt-3 text-[14px] text-muted-foreground">
            {total === 0
              ? technicianName
                ? `Nothing on your route, ${technicianName.split(" ")[0]}.`
                : "Nothing on your route."
              : `${remaining} ${remaining === 1 ? "job" : "jobs"} ahead · ${total} in view.`}
          </p>
        </header>

        <div className="mt-8">
          {total === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-8">
              {groups.map((g, gi) => (
                <DayGroup key={g.key} group={g} groupIndex={gi} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DayGroup({
  group,
  groupIndex
}: {
  group: { key: string; appointments: AssignedAppointment[] };
  groupIndex: number;
}) {
  const heading = dayHeader(group.appointments[0]!.slot_start);
  const count = group.appointments.filter((a) => a.status !== "cancelled").length;

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-border pb-2.5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            {heading.eyebrow}
          </p>
          <h2 className="font-serif text-[22px] text-ink">{heading.title}</h2>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {count} {count === 1 ? "job" : "jobs"}
        </span>
      </div>

      <ul className="space-y-2.5">
        {group.appointments.map((a, i) => (
          <li key={a.id}>
            <JobCard appointment={a} index={groupIndex * 100 + i} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function JobCard({
  appointment,
  index
}: {
  appointment: AssignedAppointment;
  index: number;
}) {
  const headline = appointment.customer?.name?.trim() || "Unknown customer";
  const address = appointment.customer?.address?.trim() || null;
  const isCancelled = appointment.status === "cancelled";
  const isCompleted = appointment.status === "completed";

  return (
    <Link
      href={`/tech/jobs/${appointment.id}`}
      className={cn(
        "relative grid grid-cols-[auto_1fr_auto] items-stretch gap-x-4 border border-border bg-card px-4 py-4 transition-colors",
        "active:bg-card/70 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary",
        "animate-card-in",
        isCancelled && "opacity-60"
      )}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-[3px]", stripeClass(appointment.status))} />

      {/* Time column */}
      <div className="flex flex-col items-end font-mono leading-none">
        <span className="text-[20px] tabular-nums tracking-tight text-ink">
          {formatSlotTime(appointment.slot_start)}
        </span>
        <ArrowDown
          aria-hidden="true"
          className="my-1 h-3 w-3 text-muted-foreground/60"
          strokeWidth={1.5}
        />
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {formatSlotTime(appointment.slot_end)}
        </span>
      </div>

      {/* Content */}
      <div className="min-w-0">
        <h3
          className={cn(
            "font-serif text-[20px] leading-tight text-ink",
            isCancelled && "line-through decoration-2"
          )}
        >
          {headline}
        </h3>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          <span>{appointment.pest_type}</span>
        </p>
        {address && (
          <p className="mt-1.5 flex items-start gap-1 truncate text-[12px] text-muted-foreground">
            <MapPin className="mt-[2px] h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{address}</span>
          </p>
        )}
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <StatusBadge status={appointment.status} />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
            {appointment.confirmation_code}
          </span>
        </div>
      </div>

      {/* Chevron */}
      <ChevronRight
        aria-hidden="true"
        className="h-4 w-4 self-center text-muted-foreground/40"
      />
    </Link>
  );
}

function StatusBadge({ status }: { status: AppointmentStatus }) {
  if (status === "booked") {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-foreground/70">
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/40" />
        Booked
      </span>
    );
  }
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-primary">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        Done
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-destructive">
      <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
      Cancelled
    </span>
  );
}

function stripeClass(status: AppointmentStatus): string {
  if (status === "completed") return "bg-primary/70";
  if (status === "cancelled") return "bg-destructive/60";
  return "bg-primary";
}

function EmptyState() {
  return (
    <div className="relative isolate overflow-hidden border border-border bg-card px-6 py-16 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        <CalendarOff className="mr-1.5 inline h-3 w-3 -translate-y-px" />
        Nothing assigned
      </p>
      <h2 className="mt-4 font-serif text-[28px] italic leading-tight text-ink">
        Quiet day ahead.
      </h2>
      <p className="mx-auto mt-3 max-w-xs text-[13px] text-muted-foreground">
        When dispatch assigns you a job, it&apos;ll land here.
      </p>
    </div>
  );
}

function groupByDay(
  items: AssignedAppointment[]
): Array<{ key: string; appointments: AssignedAppointment[] }> {
  const map = new Map<string, AssignedAppointment[]>();
  for (const item of items) {
    const k = dayKey(item.slot_start);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, appointments]) => ({ key, appointments }));
}

function sortByTime(items: AssignedAppointment[]): AssignedAppointment[] {
  return [...items].sort(
    (a, b) => new Date(a.slot_start).getTime() - new Date(b.slot_start).getTime()
  );
}

function stripAssignment(row: RealtimeAppointmentRow): Omit<AssignedAppointment, "customer"> {
  return {
    id: row.id,
    customer_id: row.customer_id,
    confirmation_code: row.confirmation_code,
    pest_type: row.pest_type,
    slot_start: row.slot_start,
    slot_end: row.slot_end,
    status: row.status,
    completed_at: row.completed_at
  };
}
