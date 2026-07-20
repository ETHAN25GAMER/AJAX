import Link from "next/link";
import { addDays, format, startOfDay, subDays } from "date-fns";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CalendarCheck2,
  MessageSquare,
  Users,
  UserCheck,
  UserPlus,
  type LucideIcon
} from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { cn } from "@/lib/utils";
import { formatSlotTime } from "@/lib/time";
import { RelativeTime } from "@/components/relative-time";
import type {
  AppointmentStatus,
  Profile,
  Urgency
} from "@/lib/supabase/types";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

type EscalationSummary = {
  id: string;
  summary: string;
  urgency: Urgency;
  created_at: string;
  customers: { name: string | null; phone: string } | null;
};

type AppointmentSummary = {
  id: string;
  confirmation_code: string;
  pest_type: string;
  slot_start: string;
  status: AppointmentStatus;
  assigned_technician_id: string | null;
  customers: { name: string | null; phone: string } | null;
};

export default async function OverviewPage() {
  const session = await requireRole("admin");
  const supabase = await createSupabaseServerClient();

  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const dayAfterTomorrow = addDays(today, 2);
  const oneDayAgo = subDays(now, 1);
  const horizonEnd = addDays(today, 3);

  const [
    escalationsResult,
    todayAppointmentsResult,
    unassignedResult,
    activeConvosResult,
    profilesResult
  ] = await Promise.all([
    supabase
      .from("escalations")
      .select("id, summary, urgency, created_at, customers(name, phone)")
      .eq("resolved", false)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("appointments")
      .select(
        "id, confirmation_code, pest_type, slot_start, status, assigned_technician_id, customers(name, phone)"
      )
      .gte("slot_start", today.toISOString())
      .lt("slot_start", tomorrow.toISOString())
      .order("slot_start", { ascending: true }),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .gte("slot_start", today.toISOString())
      .lt("slot_start", horizonEnd.toISOString())
      .is("assigned_technician_id", null)
      .neq("status", "cancelled"),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .gt("last_message_at", oneDayAgo.toISOString()),
    supabase.from("profiles").select("*")
  ]);

  const escalations = ((escalationsResult.data ?? []) as unknown) as EscalationSummary[];
  const todayAppointments =
    ((todayAppointmentsResult.data ?? []) as unknown) as AppointmentSummary[];
  const unassignedCount = unassignedResult.count ?? 0;
  const activeConvoCount = activeConvosResult.count ?? 0;
  const profiles = (profilesResult.data ?? []) as Profile[];

  const adminCount = profiles.filter((p) => p.role === "admin").length;
  const techCount = profiles.filter((p) => p.role === "technician").length;

  const highUrgency = escalations.filter((e) => e.urgency === "high").length;
  const liveActiveBookings = todayAppointments.filter((a) => a.status !== "cancelled").length;

  const greeting = greetingFor(now);
  const displayName =
    session.profile.full_name?.trim() ||
    session.email?.split("@")[0] ||
    "there";

  return (
    <div className="surface-paper min-h-dvh">
      <div className="mx-auto max-w-6xl px-5 py-10 md:px-10 md:py-14">
        <Header
          greeting={greeting}
          displayName={displayName}
          dateLabel={format(now, "EEEE, d MMMM")}
        />

        <section
          aria-label="At a glance"
          className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <StatCard
            tone={highUrgency > 0 ? "danger" : "default"}
            icon={highUrgency > 0 ? AlertOctagon : AlertTriangle}
            label="Open escalations"
            value={escalations.length}
            sub={
              escalations.length === 0
                ? "All clear."
                : highUrgency > 0
                ? `${highUrgency} high-urgency`
                : "Nothing urgent."
            }
            href="/admin/escalations"
            linkLabel="View triage"
          />
          <StatCard
            tone={unassignedCount > 0 ? "warning" : "default"}
            icon={CalendarCheck2}
            label="Today's bookings"
            value={liveActiveBookings}
            sub={
              unassignedCount === 0
                ? "All assigned."
                : `${unassignedCount} unassigned in the next 3 days`
            }
            href="/admin/appointments"
            linkLabel="See schedule"
          />
          <StatCard
            icon={MessageSquare}
            label="Active threads"
            value={activeConvoCount}
            sub="messages in last 24h"
            href="/admin/conversations"
            linkLabel="Browse"
          />
          <StatCard
            icon={Users}
            label="Team"
            value={profiles.length}
            sub={`${adminCount} admin${adminCount === 1 ? "" : "s"} · ${techCount} technician${techCount === 1 ? "" : "s"}`}
            href="/admin/users"
            linkLabel="Manage"
          />
        </section>

        <div className="mt-12 grid gap-10 md:grid-cols-2">
          <RecentEscalations escalations={escalations.slice(0, 4)} />
          <TodaySchedule appointments={todayAppointments.slice(0, 5)} />
        </div>
      </div>
    </div>
  );
}

function Header({
  greeting,
  displayName,
  dateLabel
}: {
  greeting: string;
  displayName: string;
  dateLabel: string;
}) {
  return (
    <header>
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {dateLabel}
      </p>
      <h1 className="mt-3 font-serif text-[44px] leading-[1.02] tracking-tight text-ink md:text-[56px]">
        {greeting}, {displayName}.
      </h1>
      <p className="mt-3 text-base text-muted-foreground">
        Here&apos;s what&apos;s happening right now.
      </p>
    </header>
  );
}

function StatCard({
  tone = "default",
  icon: Icon,
  label,
  value,
  sub,
  href,
  linkLabel
}: {
  tone?: "default" | "danger" | "warning";
  icon: LucideIcon;
  label: string;
  value: number;
  sub: string;
  href: string;
  linkLabel: string;
}) {
  const accent =
    tone === "danger"
      ? "text-urgency-high border-urgency-high/40"
      : tone === "warning"
      ? "text-urgency-normal border-urgency-normal/40"
      : "text-muted-foreground border-border";

  return (
    <Link
      href={href}
      className={cn(
        "group relative flex flex-col justify-between border bg-card p-5 transition-colors",
        "hover:border-foreground/30",
        accent.split(" ").find((c) => c.startsWith("border-"))
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em]",
            accent.split(" ").find((c) => c.startsWith("text-"))
          )}
        >
          <Icon className="h-3 w-3" aria-hidden />
          {label}
        </span>
      </div>
      <div className="mt-6">
        <span className="font-serif text-[56px] leading-none tracking-tight text-ink">
          {value}
        </span>
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">{sub}</p>
      <span className="mt-4 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors group-hover:text-foreground">
        {linkLabel}
        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

function RecentEscalations({ escalations }: { escalations: EscalationSummary[] }) {
  return (
    <section>
      <PanelHeader title="Recent escalations" href="/admin/escalations" linkLabel="View all" />

      {escalations.length === 0 ? (
        <EmptyPanel label="No open escalations" detail="Nothing needs attention right now." />
      ) : (
        <ul className="divide-y divide-border border border-border bg-card">
          {escalations.map((e) => {
            const customerLabel =
              e.customers?.name?.trim() || e.customers?.phone || "Unknown customer";
            return (
              <li key={e.id} className="relative pl-3 md:pl-4">
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 w-[3px]",
                    e.urgency === "high" && "bg-urgency-high animate-pulse-bar",
                    e.urgency === "normal" && "bg-urgency-normal",
                    e.urgency === "low" && "bg-urgency-low/60"
                  )}
                  aria-hidden
                />
                <Link
                  href="/admin/escalations"
                  className="block px-4 py-4 transition-colors hover:bg-accent/40 md:px-5"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-serif text-[18px] leading-tight text-ink">
                      {customerLabel}
                    </span>
                    <RelativeTime
                      as="time"
                      iso={e.created_at}
                      className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
                    />
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[13px] text-muted-foreground">
                    {e.summary}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function TodaySchedule({ appointments }: { appointments: AppointmentSummary[] }) {
  return (
    <section>
      <PanelHeader title="Today's schedule" href="/admin/appointments" linkLabel="View all" />

      {appointments.length === 0 ? (
        <EmptyPanel label="Nothing on the books today" detail="Quiet day. Enjoy it." />
      ) : (
        <ul className="divide-y divide-border border border-border bg-card">
          {appointments.map((a) => {
            const customerLabel =
              a.customers?.name?.trim() || a.customers?.phone || "Unknown customer";
            const isCancelled = a.status === "cancelled";
            const isUnassigned = a.assigned_technician_id == null && !isCancelled;
            return (
              <li key={a.id}>
                <Link
                  href="/admin/appointments"
                  className={cn(
                    "block px-4 py-4 transition-colors hover:bg-accent/40 md:px-5",
                    isCancelled && "opacity-60"
                  )}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-[16px] tabular-nums tracking-tight text-ink">
                      {formatSlotTime(a.slot_start)}
                    </span>
                    {isUnassigned ? (
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-urgency-normal">
                        <UserPlus className="h-3 w-3" />
                        Unassigned
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-primary">
                        <UserCheck className="h-3 w-3" />
                        Assigned
                      </span>
                    )}
                  </div>
                  <p
                    className={cn(
                      "mt-1 font-serif text-[16px] leading-tight text-ink",
                      isCancelled && "line-through decoration-2"
                    )}
                  >
                    {customerLabel}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {a.pest_type}
                    <span className="mx-1.5 text-muted-foreground/60">·</span>
                    <span className="font-mono uppercase tracking-[0.12em]">
                      {a.confirmation_code}
                    </span>
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PanelHeader({
  title,
  href,
  linkLabel
}: {
  title: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4 border-b border-border pb-2">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        {title}
      </h2>
      <Link
        href={href}
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
      >
        {linkLabel}
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

function EmptyPanel({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="border border-dashed border-border bg-card px-5 py-10 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 font-serif text-xl italic text-ink">{detail}</p>
    </div>
  );
}

function greetingFor(now: Date): string {
  const h = now.getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
