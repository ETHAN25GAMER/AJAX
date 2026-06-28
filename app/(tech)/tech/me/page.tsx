import { addDays, startOfDay } from "date-fns";
import { LogOut, Mail, Phone, ShieldCheck } from "lucide-react";
import { signOut } from "@/lib/auth/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { formatSlotTime } from "@/lib/time";

export const metadata = { title: "Me" };
export const dynamic = "force-dynamic";

type AppointmentRow = {
  id: string;
  status: "booked" | "completed" | "cancelled";
  slot_start: string;
  completed_at: string | null;
};

export default async function TechMePage() {
  const session = await requireRole("technician");
  const sb = await createSupabaseServerClient();

  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = addDays(dayStart, 1);

  const { data: rows } = await sb
    .from("appointments")
    .select("id, status, slot_start, completed_at")
    .eq("assigned_technician_id", session.userId)
    .gte("slot_start", dayStart.toISOString())
    .lt("slot_start", dayEnd.toISOString());

  const todays = (rows ?? []) as AppointmentRow[];
  const done = todays.filter((r) => r.status === "completed").length;
  const remaining = todays.filter((r) => r.status === "booked").length;
  const cancelled = todays.filter((r) => r.status === "cancelled").length;
  const nextUp = todays
    .filter((r) => r.status === "booked")
    .sort((a, b) => a.slot_start.localeCompare(b.slot_start))[0];

  const displayName = session.profile.full_name?.trim() || session.email?.split("@")[0] || "Technician";

  return (
    <div className="surface-paper min-h-dvh">
      <div className="mx-auto max-w-md px-5 pb-6 pt-8">
        <header>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            You · Today
          </p>
          <h1 className="mt-3 font-serif text-[44px] leading-[1.02] tracking-tight text-ink">
            Me.
          </h1>
          <p className="mt-3 text-[14px] text-muted-foreground">
            Signed in as <span className="text-foreground">{displayName}</span>.
          </p>
        </header>

        <section className="mt-8 border border-border bg-card px-4 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Profile
          </p>
          <h2 className="mt-1.5 font-serif text-[22px] leading-tight text-ink">{displayName}</h2>
          <ul className="mt-3 space-y-1.5 text-[13px] text-muted-foreground">
            {session.email && (
              <li className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="font-mono">{session.email}</span>
              </li>
            )}
            {session.profile.phone && (
              <li className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="font-mono tabular-nums">{session.profile.phone}</span>
              </li>
            )}
            <li className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="font-mono uppercase tracking-[0.14em]">{session.profile.role}</span>
            </li>
          </ul>
        </section>

        <section className="mt-6">
          <p className="mb-2 border-b border-border pb-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Today
          </p>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Done" value={done} tone="primary" />
            <StatTile label="Remaining" value={remaining} tone={remaining > 0 ? "default" : "muted"} />
            <StatTile label="Cancelled" value={cancelled} tone={cancelled > 0 ? "destructive" : "muted"} />
          </div>
          {nextUp ? (
            <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Next up · {formatSlotTime(nextUp.slot_start)}
            </p>
          ) : todays.length === 0 ? (
            <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              No jobs on the books today.
            </p>
          ) : (
            <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-primary">
              You&apos;re clear for the day.
            </p>
          )}
        </section>

        <section className="mt-8">
          <form action={signOut}>
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-2 border border-border bg-card px-4 py-3 text-[13px] font-medium text-foreground transition-colors hover:border-destructive hover:text-destructive"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "primary" | "default" | "muted" | "destructive";
}) {
  const toneClass =
    tone === "primary"
      ? "text-primary"
      : tone === "destructive"
      ? "text-destructive"
      : tone === "muted"
      ? "text-muted-foreground"
      : "text-foreground";

  return (
    <div className="border border-border bg-card px-3 py-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 font-mono text-[26px] tabular-nums leading-none ${toneClass}`}>{value}</p>
    </div>
  );
}
