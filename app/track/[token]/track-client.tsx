"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, MapPin, Navigation } from "lucide-react";
import { estimatedMinutes, haversineKm, type LatLng } from "@/lib/geo";
import { RelativeTime } from "@/components/relative-time";
import { BRAND } from "@/lib/brand";

export type TrackInitial = {
  token: string;
  techName: string;
  confirmationCode: string;
  customerName: string | null;
  customerAddress: string | null;
  destination: LatLng | null;
  position: { lat: number; lng: number; updated_at: string } | null;
  status: "en_route" | "arrived";
};

type ApiResponse =
  | {
      status: "en_route" | "arrived";
      tech_name: string;
      confirmation_code: string;
      position: { lat: number; lng: number; updated_at: string } | null;
      destination: LatLng | null;
    }
  | { status: "revoked" };

const POLL_INTERVAL_MS = 30_000;

export function TrackClient({ initial }: { initial: TrackInitial }) {
  const [position, setPosition] = useState(initial.position);
  const [destination, setDestination] = useState<LatLng | null>(initial.destination);
  const [status, setStatus] = useState<"en_route" | "arrived" | "revoked">(initial.status);

  const greeting = useMemo(() => {
    const first = initial.customerName?.trim().split(" ")[0];
    return first ? `Hi ${first}.` : "Hi.";
  }, [initial.customerName]);

  useEffect(() => {
    if (status === "revoked") return;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`/api/track/${initial.token}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as ApiResponse;
        if (cancelled) return;
        if (body.status === "revoked") {
          setStatus("revoked");
          return;
        }
        setStatus(body.status);
        if (body.position) setPosition(body.position);
        if (body.destination) setDestination(body.destination);
      } catch {
        // Network blips — next tick will retry.
      }
    };

    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [initial.token, status]);

  if (status === "revoked") return <RevokedView />;

  const distanceKm = position && destination ? haversineKm(position, destination) : null;
  const etaMin = distanceKm != null ? estimatedMinutes(distanceKm) : null;
  const mapsUrl = position
    ? `https://www.google.com/maps?q=${position.lat},${position.lng}`
    : null;

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-md px-5 pb-10 pt-10">
        <header>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            {BRAND.company} · Live tracking
          </p>
          <h1 className="mt-3 font-serif text-[40px] leading-[1.05] tracking-tight text-ink">
            {greeting}
          </h1>
          <p className="mt-3 text-[15px] text-muted-foreground">
            <span className="text-foreground">{initial.techName}</span> is{" "}
            {status === "arrived"
              ? "on site."
              : etaMin != null
              ? `about ${etaMin} ${etaMin === 1 ? "minute" : "minutes"} away.`
              : "on the way."}
          </p>
        </header>

        {/* ETA card */}
        <section className="mt-8 border border-border bg-card px-5 py-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            {status === "arrived" ? "On site" : "Estimated arrival"}
          </p>
          <p className="mt-3 font-serif text-[56px] leading-none tracking-tight text-ink">
            {status === "arrived"
              ? "Now."
              : etaMin != null
              ? `~${etaMin} min`
              : "—"}
          </p>
          {distanceKm != null && status !== "arrived" && (
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {distanceKm < 1
                ? `${Math.round(distanceKm * 1000)} m away`
                : `${distanceKm.toFixed(1)} km away`}
            </p>
          )}

          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex w-full items-center justify-center gap-2 border border-primary bg-transparent px-4 py-3 text-[13px] font-medium text-primary transition-colors hover:bg-primary/10"
            >
              <Navigation className="h-4 w-4" />
              Open tech location in Maps
              <ExternalLink className="h-3 w-3 opacity-70" />
            </a>
          )}
        </section>

        {/* Destination */}
        {initial.customerAddress && (
          <section className="mt-5">
            <p className="border-b border-border pb-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Destination
            </p>
            <p className="mt-3 flex items-start gap-2 text-[14px] text-foreground">
              <MapPin className="mt-[3px] h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{initial.customerAddress}</span>
            </p>
          </section>
        )}

        {/* Footer */}
        <section className="mt-8 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            {status === "arrived" ? (
              <CheckCircle2 className="h-3 w-3 text-primary" />
            ) : (
              <Navigation className="h-3 w-3 text-primary" />
            )}
            {status === "arrived" ? "Arrived" : "En route"}
          </span>
          <span>Job · {initial.confirmationCode}</span>
        </section>

        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {position ? (
            <RelativeTime iso={position.updated_at} prefix="Last update · " />
          ) : (
            "Waiting for the first position…"
          )}
        </p>
      </div>
    </div>
  );
}

function RevokedView() {
  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-md px-5 pb-10 pt-12 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {BRAND.company} · Live tracking
        </p>
        <h1 className="mt-6 font-serif text-[40px] leading-[1.05] tracking-tight text-ink">
          Job complete.
        </h1>
        <p className="mt-3 text-[14px] text-muted-foreground">
          Your technician has wrapped up. Thanks for choosing {BRAND.company}.
        </p>
      </div>
    </div>
  );
}
