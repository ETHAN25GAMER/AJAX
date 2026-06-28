"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Navigation, Users } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { RelativeTime } from "@/components/relative-time";

export type DispatchTech = {
  technician_id: string;
  appointment_id: string | null;
  confirmation_code: string | null;
  customer_name: string | null;
  tech_name: string;
  lat: number;
  lng: number;
  updated_at: string;
};

export function DispatchClient({ initial }: { initial: DispatchTech[] }) {
  const [techs, setTechs] = useState<DispatchTech[]>(initial);
  const techsRef = useRef<DispatchTech[]>(initial);
  techsRef.current = techs;

  const supabaseRef = useRef<ReturnType<typeof createSupabaseBrowserClient> | null>(null);
  const channelRef = useRef<ReturnType<NonNullable<typeof supabaseRef.current>["channel"]> | null>(
    null
  );
  if (!supabaseRef.current) supabaseRef.current = createSupabaseBrowserClient();

  useEffect(() => {
    const sb = supabaseRef.current!;
    let cancelled = false;

    (async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (token) sb.realtime.setAuth(token);
      if (cancelled) return;

      const channel = sb
        .channel("dispatch-positions")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "technician_positions" },
          async (payload) => {
            const row = payload.new as DispatchTech;
            const enriched = await enrichTech(sb, row);
            setTechs((prev) =>
              [...prev.filter((t) => t.technician_id !== row.technician_id), enriched].sort(
                (a, b) => b.updated_at.localeCompare(a.updated_at)
              )
            );
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "technician_positions" },
          async (payload) => {
            const row = payload.new as DispatchTech;
            const existing = techsRef.current.find((t) => t.technician_id === row.technician_id);
            if (existing) {
              setTechs((prev) =>
                prev.map((t) =>
                  t.technician_id === row.technician_id
                    ? {
                        ...t,
                        lat: row.lat,
                        lng: row.lng,
                        updated_at: row.updated_at,
                        appointment_id: row.appointment_id
                      }
                    : t
                )
              );
            } else {
              const enriched = await enrichTech(sb, row);
              setTechs((prev) => [...prev, enriched]);
            }
          }
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "technician_positions" },
          (payload) => {
            const row = payload.old as { technician_id: string };
            setTechs((prev) => prev.filter((t) => t.technician_id !== row.technician_id));
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

  const total = techs.length;
  const lead = useMemo(() => {
    if (total === 0) return "No techs sharing right now.";
    return `${total} ${total === 1 ? "tech" : "techs"} en route.`;
  }, [total]);

  return (
    <div className="surface-paper min-h-dvh">
      <div className="mx-auto max-w-4xl px-5 py-10 md:px-10 md:py-14">
        <header>
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Field · Live
            </p>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Live
              <span className="ml-1.5 inline-block h-1.5 w-1.5 translate-y-[-1px] rounded-full bg-primary align-middle animate-pulse-bar" />
            </span>
          </div>
          <h1 className="mt-3 font-serif text-[44px] leading-[1.02] tracking-tight text-ink md:text-[56px]">
            Dispatch.
          </h1>
          <p className="mt-3 text-base text-muted-foreground">
            <Navigation className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px" />
            {lead}
          </p>
        </header>

        <div className="mt-10">
          {techs.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="space-y-3">
              {techs.map((t) => (
                <li key={t.technician_id}>
                  <TechRow tech={t} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function TechRow({ tech }: { tech: DispatchTech }) {
  const mapsUrl = `https://www.google.com/maps?q=${tech.lat},${tech.lng}`;

  return (
    <div className="relative grid grid-cols-[1fr_auto] items-center gap-4 border border-border bg-card px-5 py-4 md:px-6">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-primary" />

      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="truncate font-serif text-[22px] leading-tight text-ink">{tech.tech_name}</h3>
          <RelativeTime
            iso={tech.updated_at}
            className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
          />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          <span>{tech.confirmation_code ?? "—"}</span>
          {tech.customer_name && (
            <>
              <span className="text-muted-foreground/60">·</span>
              <span className="normal-case tracking-normal text-foreground/80">
                → {tech.customer_name}
              </span>
            </>
          )}
        </div>
        <p className="mt-2 font-mono text-[11px] tabular-nums text-muted-foreground/80">
          {tech.lat.toFixed(5)}, {tech.lng.toFixed(5)}
        </p>
      </div>

      <a
        href={mapsUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 items-center gap-1.5 border border-border bg-background px-3 py-2 text-[12px] text-foreground transition-colors hover:border-primary hover:text-primary"
      >
        <Navigation className="h-3.5 w-3.5" />
        Open
        <ExternalLink className="h-3 w-3 opacity-70" />
      </a>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border border-border bg-card px-8 py-20 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        <Users className="mr-1.5 inline h-3 w-3 -translate-y-px" />
        Nobody sharing
      </p>
      <h2 className="mt-4 font-serif text-4xl italic leading-tight text-ink">Field's quiet.</h2>
      <p className="mx-auto mt-3 max-w-sm text-[14px] text-muted-foreground">
        Techs appear here the moment they tap &ldquo;Start travel&rdquo; on a job.
      </p>
    </div>
  );
}

async function enrichTech(
  sb: ReturnType<typeof createSupabaseBrowserClient>,
  row: DispatchTech
): Promise<DispatchTech> {
  let tech_name = row.tech_name;
  let confirmation_code: string | null = null;
  let customer_name: string | null = null;

  const { data: profile } = await sb
    .from("profiles")
    .select("full_name")
    .eq("id", row.technician_id)
    .maybeSingle();
  if (profile?.full_name) tech_name = profile.full_name.trim();

  if (row.appointment_id) {
    const { data: appt } = await sb
      .from("appointments")
      .select("confirmation_code, customers(name)")
      .eq("id", row.appointment_id)
      .maybeSingle();
    if (appt) {
      confirmation_code = appt.confirmation_code;
      const cust = (appt.customers as unknown) as { name: string | null } | null;
      customer_name = cust?.name ?? null;
    }
  }

  return {
    ...row,
    tech_name: tech_name || "Unnamed tech",
    confirmation_code,
    customer_name
  };
}
