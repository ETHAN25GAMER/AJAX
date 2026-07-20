"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ChangeEvent
} from "react";
import {
  ArrowDown,
  ChevronDown,
  Phone,
  TagIcon,
  UserCheck,
  UserPlus,
  CalendarOff
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { dayHeader, dayKey, formatSlotTime } from "@/lib/time";
import { assignTechnician } from "./actions";
import type { AppointmentStatus } from "@/lib/supabase/types";

export type AppointmentWithCustomer = {
  id: string;
  customer_id: string;
  confirmation_code: string;
  pest_type: string;
  slot_start: string;
  slot_end: string;
  status: AppointmentStatus;
  price_quoted: number | null;
  reminder_confirmed_at: string | null;
  assigned_technician_id: string | null;
  customer: {
    id: string;
    phone: string;
    name: string | null;
  } | null;
};

export type TechnicianOption = { id: string; label: string };

type Filter = "all" | AppointmentStatus | "unassigned";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "booked", label: "Booked" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "unassigned", label: "Unassigned" }
];

const STATUS_COPY: Record<AppointmentStatus, string> = {
  booked: "Booked",
  completed: "Completed",
  cancelled: "Cancelled"
};

export function AppointmentsClient({
  initial,
  technicians,
  horizonDays
}: {
  initial: AppointmentWithCustomer[];
  technicians: TechnicianOption[];
  horizonDays: number;
}) {
  const [appointments, setAppointments] = useState<AppointmentWithCustomer[]>(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const supabaseRef = useRef<ReturnType<typeof createSupabaseBrowserClient> | null>(null);
  const channelRef = useRef<ReturnType<NonNullable<typeof supabaseRef.current>["channel"]> | null>(null);

  if (!supabaseRef.current) supabaseRef.current = createSupabaseBrowserClient();

  // Realtime — new bookings from WhatsApp appear without refresh, and
  // status/assignment changes from other admins sync in too.
  useEffect(() => {
    const supabase = supabaseRef.current!;
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) supabase.realtime.setAuth(token);
      if (cancelled) return;

      const channel = supabase
        .channel("appointments-board")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "appointments" },
          async (payload) => {
            const row = payload.new as Omit<AppointmentWithCustomer, "customer">;
            const { data: customer } = await supabase
              .from("customers")
              .select("id, phone, name")
              .eq("id", row.customer_id)
              .maybeSingle();
            setAppointments((prev) =>
              sortByTime([
                ...prev.filter((a) => a.id !== row.id),
                { ...row, customer: customer ?? null }
              ])
            );
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "appointments" },
          (payload) => {
            const row = payload.new as Omit<AppointmentWithCustomer, "customer">;
            setAppointments((prev) =>
              prev.map((a) => (a.id === row.id ? { ...a, ...row } : a))
            );
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

  const visible = useMemo(() => {
    if (filter === "all") return appointments;
    if (filter === "unassigned")
      return appointments.filter((a) => a.assigned_technician_id == null);
    return appointments.filter((a) => a.status === filter);
  }, [appointments, filter]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: appointments.length,
      booked: 0,
      completed: 0,
      cancelled: 0,
      unassigned: 0
    };
    for (const a of appointments) {
      c[a.status]++;
      if (a.assigned_technician_id == null) c.unassigned++;
    }
    return c;
  }, [appointments]);

  const groups = useMemo(() => groupByDay(visible), [visible]);

  const techMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of technicians) m.set(t.id, t.label);
    return m;
  }, [technicians]);

  return (
    <div className="surface-paper min-h-dvh">
      <div className="mx-auto max-w-4xl px-5 py-10 md:px-10 md:py-14">
        <Header counts={counts} horizonDays={horizonDays} filter={filter} setFilter={setFilter} />

        <div className="mt-10">
          {visible.length === 0 ? (
            <EmptyState horizonDays={horizonDays} filtered={filter !== "all"} />
          ) : (
            <div className="space-y-12">
              {groups.map((g, gi) => (
                <DayGroup
                  key={g.key}
                  group={g}
                  groupIndex={gi}
                  technicians={technicians}
                  techMap={techMap}
                  onAssigned={(id, technicianId) => {
                    setAppointments((prev) =>
                      prev.map((a) =>
                        a.id === id ? { ...a, assigned_technician_id: technicianId } : a
                      )
                    );
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Header({
  counts,
  horizonDays,
  filter,
  setFilter
}: {
  counts: Record<Filter, number>;
  horizonDays: number;
  filter: Filter;
  setFilter: (f: Filter) => void;
}) {
  return (
    <header>
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Schedule · Next {horizonDays} days
        </p>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Live
          <span className="ml-1.5 inline-block h-1.5 w-1.5 translate-y-[-1px] rounded-full bg-primary align-middle animate-pulse-bar" />
        </span>
      </div>

      <h1 className="mt-3 font-serif text-[44px] leading-[1.02] tracking-tight text-ink md:text-[56px]">
        Appointments.
      </h1>

      <p className="mt-3 text-base text-muted-foreground">
        {counts.all === 0
          ? "Nothing on the books."
          : `${counts.all} appointment${counts.all === 1 ? "" : "s"} in view${
              counts.unassigned > 0 ? ` · ${counts.unassigned} unassigned` : ""
            }.`}
      </p>

      <div
        role="tablist"
        aria-label="Filter appointments"
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
                "inline-flex items-center gap-2 px-3 py-1.5 text-[12px] font-medium tracking-tight transition-colors border border-transparent",
                selected
                  ? "border-border bg-card text-foreground shadow-[0_1px_0_0_hsl(var(--border))]"
                  : "text-muted-foreground hover:text-foreground",
                id === "unassigned" && n > 0 && !selected && "text-urgency-normal"
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

function DayGroup({
  group,
  groupIndex,
  technicians,
  techMap,
  onAssigned
}: {
  group: { key: string; appointments: AppointmentWithCustomer[] };
  groupIndex: number;
  technicians: TechnicianOption[];
  techMap: Map<string, string>;
  onAssigned: (appointmentId: string, technicianId: string | null) => void;
}) {
  const heading = dayHeader(group.appointments[0]!.slot_start);
  const bookedToday = group.appointments.filter((a) => a.status !== "cancelled").length;

  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-border pb-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            {heading.eyebrow}
          </p>
          <h2 className="font-serif text-2xl text-ink">{heading.title}</h2>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {bookedToday} {bookedToday === 1 ? "booking" : "bookings"}
        </span>
      </div>

      <ul className="space-y-3">
        {group.appointments.map((a, i) => (
          <AppointmentRow
            key={a.id}
            appointment={a}
            index={groupIndex * 100 + i}
            technicians={technicians}
            techLabel={
              a.assigned_technician_id ? techMap.get(a.assigned_technician_id) ?? "Unknown" : null
            }
            onAssigned={(technicianId) => onAssigned(a.id, technicianId)}
          />
        ))}
      </ul>
    </section>
  );
}

function AppointmentRow({
  appointment,
  index,
  technicians,
  techLabel,
  onAssigned
}: {
  appointment: AppointmentWithCustomer;
  index: number;
  technicians: TechnicianOption[];
  techLabel: string | null;
  onAssigned: (technicianId: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const headline = appointment.customer?.name?.trim() || "Unknown customer";
  const phone = appointment.customer?.phone ?? "—";
  const isCancelled = appointment.status === "cancelled";
  const isCompleted = appointment.status === "completed";
  const isUnassigned = appointment.assigned_technician_id == null && !isCancelled;

  const onChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      setError(null);
      const value = e.target.value || null;
      startTransition(async () => {
        const result = await assignTechnician(appointment.id, value);
        if (!result.ok) {
          setError(result.error);
        } else {
          onAssigned(value);
        }
      });
    },
    [appointment.id, onAssigned]
  );

  return (
    <li
      className={cn(
        "relative grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 border border-border bg-card px-5 py-5 md:gap-x-7 md:px-7",
        "animate-card-in",
        isCancelled && "opacity-60"
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Time column — train-timetable feel */}
      <div className="flex flex-col items-end font-mono leading-none">
        <span className="text-[22px] tabular-nums tracking-tight text-ink md:text-[26px]">
          {formatSlotTime(appointment.slot_start)}
        </span>
        <ArrowDown
          aria-hidden="true"
          className="my-1 h-3 w-3 text-muted-foreground/60"
          strokeWidth={1.5}
        />
        <span className="text-[12px] tabular-nums text-muted-foreground">
          {formatSlotTime(appointment.slot_end)}
        </span>
      </div>

      {/* Content column */}
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <h3
            className={cn(
              "font-serif text-[22px] leading-tight text-ink md:text-[24px]",
              isCancelled && "line-through decoration-2"
            )}
          >
            {headline}
          </h3>
          <StatusBadge status={appointment.status} />
        </div>

        <dl className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          <div className="inline-flex items-center gap-1.5">
            <TagIcon className="h-3.5 w-3.5" aria-hidden="true" />
            <dt className="sr-only">Service</dt>
            <dd>
              {appointment.pest_type}
              {appointment.price_quoted != null && (
                <>
                  <span className="mx-1.5 text-muted-foreground/60">·</span>
                  <span className="font-mono tabular-nums">
                    ${appointment.price_quoted.toFixed(0)}
                  </span>
                </>
              )}
              {appointment.reminder_confirmed_at && (
                <>
                  <span className="mx-1.5 text-muted-foreground/60">·</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
                    Confirmed ✓
                  </span>
                </>
              )}
            </dd>
          </div>
          <div className="inline-flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5" aria-hidden="true" />
            <dt className="sr-only">Phone</dt>
            <dd className="font-mono">{phone}</dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border/70 pt-3">
          <TechAssignSelect
            value={appointment.assigned_technician_id ?? ""}
            options={technicians}
            techLabel={techLabel}
            isUnassigned={isUnassigned}
            disabled={pending || isCancelled}
            onChange={onChange}
          />

          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">
            {appointment.confirmation_code}
          </span>
        </div>

        {error && <p className="mt-2 font-mono text-[11px] text-destructive">{error}</p>}
      </div>

      {isCompleted && !isCancelled && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-[3px] bg-primary/70"
        />
      )}
    </li>
  );
}

function StatusBadge({ status }: { status: AppointmentStatus }) {
  if (status === "booked") {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-foreground/70">
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/40" />
        {STATUS_COPY[status]}
      </span>
    );
  }
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-primary">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        {STATUS_COPY[status]}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-destructive">
      <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
      {STATUS_COPY[status]}
    </span>
  );
}

function TechAssignSelect({
  value,
  options,
  techLabel,
  isUnassigned,
  disabled,
  onChange
}: {
  value: string;
  options: TechnicianOption[];
  techLabel: string | null;
  isUnassigned: boolean;
  disabled: boolean;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <label
      className={cn(
        "group relative inline-flex items-center gap-2 border bg-background px-3 py-1.5 text-[12px] transition-colors",
        "hover:border-foreground/40",
        "focus-within:border-primary focus-within:ring-1 focus-within:ring-primary",
        isUnassigned ? "border-urgency-normal/60 border-dashed" : "border-border",
        disabled && "cursor-not-allowed opacity-60"
      )}
    >
      {isUnassigned ? (
        <UserPlus className="h-3.5 w-3.5 text-urgency-normal" aria-hidden="true" />
      ) : (
        <UserCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
      )}
      <span className="sr-only">Assigned technician</span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className={cn(
            "tabular-nums",
            isUnassigned ? "text-urgency-normal" : "text-foreground"
          )}
        >
          {isUnassigned ? "Unassigned" : techLabel ?? "Unknown"}
        </span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      </span>
      <select
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
      >
        <option value="">Unassigned</option>
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyState({ horizonDays, filtered }: { horizonDays: number; filtered: boolean }) {
  if (filtered) {
    return (
      <div className="border border-dashed border-border px-8 py-16 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          No matches
        </p>
        <p className="mt-3 font-serif text-2xl text-ink">Nothing under this filter.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Try a different status, or clear the filter.
        </p>
      </div>
    );
  }
  return (
    <div className="relative isolate overflow-hidden border border-border bg-card px-8 py-20 text-center md:py-24">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        <CalendarOff className="mr-1.5 inline h-3 w-3 -translate-y-px" />
        Nothing on the books
      </p>
      <h2 className="mt-5 font-serif text-4xl italic leading-tight text-ink md:text-5xl">
        Quiet days ahead.
      </h2>
      <p className="mx-auto mt-4 max-w-sm text-[14px] text-muted-foreground">
        No appointments in the next {horizonDays} days. When a customer books over WhatsApp, it
        will land here.
      </p>
    </div>
  );
}

function groupByDay(
  items: AppointmentWithCustomer[]
): Array<{ key: string; appointments: AppointmentWithCustomer[] }> {
  const map = new Map<string, AppointmentWithCustomer[]>();
  for (const item of items) {
    const k = dayKey(item.slot_start);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, appointments]) => ({ key, appointments }));
}

function sortByTime(items: AppointmentWithCustomer[]): AppointmentWithCustomer[] {
  return [...items].sort(
    (a, b) => new Date(a.slot_start).getTime() - new Date(b.slot_start).getTime()
  );
}
