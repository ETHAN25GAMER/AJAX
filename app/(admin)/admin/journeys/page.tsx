import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { TEMPLATES } from "@/lib/whatsapp/templates";
import type { Journey, JourneyEnrollmentStatus, JourneyStep } from "@/lib/supabase/types";
import { JourneysClient, type JourneyWithDetail } from "./journeys-client";

export const metadata = { title: "Journeys" };
export const dynamic = "force-dynamic";

export default async function JourneysPage() {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("journeys")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <div className="surface-paper min-h-dvh px-6 py-16 md:px-12">
        <div className="mx-auto max-w-2xl border border-destructive/40 bg-card px-6 py-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-destructive">
            Database error
          </p>
          <p className="mt-2 text-sm text-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  const journeys = (data ?? []) as Journey[];

  const stepsByJourney = new Map<string, JourneyStep[]>();
  const counts = new Map<string, Record<JourneyEnrollmentStatus, number>>();

  if (journeys.length > 0) {
    const ids = journeys.map((j) => j.id);
    const [steps, enrollments] = await Promise.all([
      supabase
        .from("journey_steps")
        .select("journey_id, position, delay_days, template_name, template_params")
        .in("journey_id", ids)
        .order("position", { ascending: true }),
      supabase.from("journey_enrollments").select("journey_id, status").in("journey_id", ids)
    ]);

    for (const s of (steps.data ?? []) as JourneyStep[]) {
      const list = stepsByJourney.get(s.journey_id) ?? [];
      list.push({ ...s, template_params: Array.isArray(s.template_params) ? s.template_params : [] });
      stepsByJourney.set(s.journey_id, list);
    }
    for (const e of (enrollments.data ?? []) as Array<{
      journey_id: string;
      status: JourneyEnrollmentStatus;
    }>) {
      const entry = counts.get(e.journey_id) ?? { active: 0, done: 0, cancelled: 0 };
      entry[e.status]++;
      counts.set(e.journey_id, entry);
    }
  }

  const withDetail: JourneyWithDetail[] = journeys.map((j) => ({
    ...j,
    steps: stepsByJourney.get(j.id) ?? [],
    counts: counts.get(j.id) ?? { active: 0, done: 0, cancelled: 0 }
  }));

  return <JourneysClient initial={withDetail} templateOptions={[TEMPLATES.amcUpsell]} />;
}
