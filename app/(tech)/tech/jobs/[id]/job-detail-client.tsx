"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ChangeEvent
} from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  MapPin,
  Navigation,
  Phone,
  Square,
  X,
  XCircle
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { formatSlotTime, dayHeader } from "@/lib/time";
import { RelativeTime } from "@/components/relative-time";
import type { AppointmentStatus, ServiceTier, TrackingState, Urgency } from "@/lib/supabase/types";
import {
  createEscalation,
  endTrip,
  postPosition,
  recordPhoto,
  setStatus,
  startTrip,
  updateNotes
} from "./actions";

export type JobPhoto = {
  id: string;
  storage_path: string;
  kind: "before" | "after" | "damage" | "other";
  taken_at: string;
  signed_url: string;
};

export type JobDetail = {
  id: string;
  customer_id: string;
  confirmation_code: string;
  pest_type: string;
  service_tier: ServiceTier;
  slot_start: string;
  slot_end: string;
  status: AppointmentStatus;
  price_quoted: number | null;
  tech_notes: string | null;
  completed_at: string | null;
  tracking_state: TrackingState;
  tracking_url: string | null;
  customer: {
    id: string;
    name: string | null;
    phone: string;
    address: string | null;
  };
  photos: JobPhoto[];
};

type SaveState = "idle" | "saving" | "saved" | "error";
type PhotoKind = "before" | "after" | "damage";

export function JobDetailClient({ initial }: { initial: JobDetail }) {
  const [status, setStatusLocal] = useState<AppointmentStatus>(initial.status);
  const [completedAt, setCompletedAt] = useState<string | null>(initial.completed_at);
  const [notes, setNotes] = useState<string>(initial.tech_notes ?? "");
  const [photos, setPhotos] = useState<JobPhoto[]>(initial.photos);
  const [escalateOpen, setEscalateOpen] = useState(false);

  const headline = initial.customer.name?.trim() || "Unknown customer";
  const address = initial.customer.address?.trim() ?? null;
  const phone = initial.customer.phone;
  const isCompleted = status === "completed";
  const isCancelled = status === "cancelled";
  const heading = dayHeader(initial.slot_start);

  return (
    <div className="surface-paper min-h-dvh">
      <div className="mx-auto max-w-md px-5 pb-8 pt-6">
        <TopBar confirmationCode={initial.confirmation_code} />

        <header className="mt-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            {heading.eyebrow} · {formatSlotTime(initial.slot_start)} → {formatSlotTime(initial.slot_end)}
          </p>
          <h1
            className={cn(
              "mt-3 font-serif text-[36px] leading-[1.05] tracking-tight text-ink",
              isCancelled && "line-through decoration-2"
            )}
          >
            {headline}
          </h1>
          <p className="mt-2 text-[14px] text-muted-foreground">
            <span>{initial.pest_type}</span>
            <span className="mx-1.5 text-muted-foreground/60">·</span>
            <span className="capitalize">{initial.service_tier}</span>
            {initial.price_quoted != null && (
              <>
                <span className="mx-1.5 text-muted-foreground/60">·</span>
                <span className="font-mono tabular-nums">
                  ${initial.price_quoted.toFixed(0)}
                </span>
              </>
            )}
          </p>
        </header>

        <ContactRow address={address} phone={phone} />

        <TravelBlock
          appointmentId={initial.id}
          initialTrackingState={initial.tracking_state}
          initialTrackingUrl={initial.tracking_url}
          isJobActive={status === "booked"}
        />

        <StatusBlock
          status={status}
          completedAt={completedAt}
          appointmentId={initial.id}
          onChange={(next, ts) => {
            setStatusLocal(next);
            setCompletedAt(ts);
          }}
        />

        <NotesBlock
          appointmentId={initial.id}
          value={notes}
          onChange={setNotes}
          disabled={isCancelled}
        />

        <PhotosBlock
          appointmentId={initial.id}
          photos={photos}
          onAdded={(p) => setPhotos((prev) => [...prev, p])}
          disabled={isCancelled}
        />

        <EscalateBlock
          appointmentId={initial.id}
          open={escalateOpen}
          onOpen={() => setEscalateOpen(true)}
          onClose={() => setEscalateOpen(false)}
        />
      </div>
    </div>
  );
}

function TopBar({ confirmationCode }: { confirmationCode: string }) {
  return (
    <div className="flex items-center justify-between">
      <Link
        href="/tech"
        className="-ml-2 inline-flex items-center gap-1 px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Route
      </Link>
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {confirmationCode}
      </span>
    </div>
  );
}

function ContactRow({ address, phone }: { address: string | null; phone: string }) {
  const mapsHref = address
    ? `https://maps.google.com/?q=${encodeURIComponent(address)}`
    : null;

  return (
    <div className="mt-6 grid grid-cols-1 gap-2">
      {mapsHref && (
        <a
          href={mapsHref}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 border border-border bg-card px-4 py-3 transition-colors active:bg-card/70"
        >
          <MapPin className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">{address}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
        </a>
      )}
      <a
        href={`tel:${phone}`}
        className="flex items-center gap-3 border border-border bg-card px-4 py-3 transition-colors active:bg-card/70"
      >
        <Phone className="h-4 w-4 shrink-0 text-primary" />
        <span className="font-mono text-[14px] tabular-nums text-foreground">{phone}</span>
        <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground/50" />
      </a>
    </div>
  );
}

function TravelBlock({
  appointmentId,
  initialTrackingState,
  initialTrackingUrl,
  isJobActive
}: {
  appointmentId: string;
  initialTrackingState: TrackingState;
  initialTrackingUrl: string | null;
  isJobActive: boolean;
}) {
  const [active, setActive] = useState<boolean>(
    initialTrackingState === "en_route" || initialTrackingState === "arrived"
  );
  const [trackingUrl, setTrackingUrl] = useState<string | null>(initialTrackingUrl);
  const [lastPostedAt, setLastPostedAt] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const watcherIdRef = useRef<number | null>(null);
  const lastPostMsRef = useRef<number>(0);
  const POST_INTERVAL_MS = 30_000;

  const stopWatcher = useCallback(() => {
    if (watcherIdRef.current != null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watcherIdRef.current);
      watcherIdRef.current = null;
    }
  }, []);

  const startWatcher = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This browser doesn't support geolocation.");
      return;
    }
    stopWatcher();
    watcherIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        // Throttle: at most one post per POST_INTERVAL_MS.
        if (now - lastPostMsRef.current < POST_INTERVAL_MS) return;
        lastPostMsRef.current = now;

        const { latitude, longitude, accuracy, heading } = pos.coords;
        void postPosition(
          appointmentId,
          latitude,
          longitude,
          Number.isFinite(accuracy) ? accuracy : null,
          heading != null && Number.isFinite(heading) ? heading : null
        ).then((res) => {
          if (res.ok) {
            setLastPostedAt(new Date().toISOString());
            setError(null);
          } else {
            setError(res.error);
          }
        });
      },
      (geoErr) => {
        setError(geoErr.message);
      },
      { enableHighAccuracy: true, maximumAge: 25_000, timeout: 20_000 }
    );
  }, [appointmentId, stopWatcher]);

  // Auto-resume watcher when active (e.g. on page reload mid-trip), tear down
  // when the job ends or the component unmounts.
  useEffect(() => {
    if (active && isJobActive) startWatcher();
    else stopWatcher();
    return stopWatcher;
  }, [active, isJobActive, startWatcher, stopWatcher]);

  // If the parent's status flips to non-booked while we're active, the server
  // already cleaned up — mirror that in local state.
  useEffect(() => {
    if (!isJobActive && active) {
      setActive(false);
      setTrackingUrl(null);
      setLastPostedAt(null);
    }
  }, [isJobActive, active]);

  const start = () => {
    setError(null);
    startTransition(async () => {
      const result = await startTrip(appointmentId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTrackingUrl(result.data.trackingUrl);
      setActive(true);
      if (result.data.whatsappWarning) {
        setError(
          `Tracking is live, but WhatsApp didn't send: ${result.data.whatsappWarning}. Share the link manually.`
        );
      }
    });
  };

  const stop = () => {
    setError(null);
    startTransition(async () => {
      const result = await endTrip(appointmentId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setActive(false);
      setTrackingUrl(null);
      setLastPostedAt(null);
    });
  };

  const copyLink = async () => {
    if (!trackingUrl) return;
    try {
      await navigator.clipboard.writeText(trackingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy. Long-press the link to copy manually.");
    }
  };

  if (!isJobActive) {
    return (
      <Section title="Travel">
        <p className="text-[12px] text-muted-foreground">
          Travel sharing is only available while the job is booked.
        </p>
      </Section>
    );
  }

  return (
    <Section
      title="Travel"
      right={
        active ? (
          <SaveIndicator label="Live" tone="primary" />
        ) : null
      }
    >
      {!active && (
        <>
          <p className="mb-3 text-[12px] text-muted-foreground">
            Sends the customer a WhatsApp link with your live position until the job is marked done.
          </p>
          <ActionButton tone="primary" onClick={start} disabled={pending}>
            <Navigation className="h-4 w-4" />
            {pending ? "Starting…" : "Start travel"}
          </ActionButton>
        </>
      )}

      {active && (
        <div className="space-y-2.5">
          {trackingUrl && (
            <div className="flex items-center gap-2 border border-border bg-background px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                {trackingUrl}
              </span>
              <button
                type="button"
                onClick={copyLink}
                className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
              >
                <Copy className="h-3 w-3" />
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {lastPostedAt ? (
              <RelativeTime iso={lastPostedAt} prefix="Last update · " />
            ) : (
              "Waiting for first fix…"
            )}
          </p>
          <ActionButton tone="ghost" onClick={stop} disabled={pending}>
            <Square className="h-3.5 w-3.5" />
            {pending ? "Stopping…" : "Stop sharing"}
          </ActionButton>
        </div>
      )}

      {error && <p className="mt-2 font-mono text-[11px] text-destructive">{error}</p>}
    </Section>
  );
}

function StatusBlock({
  status,
  completedAt,
  appointmentId,
  onChange
}: {
  status: AppointmentStatus;
  completedAt: string | null;
  appointmentId: string;
  onChange: (next: AppointmentStatus, completedAt: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(
    (next: AppointmentStatus) => {
      if (next === status) return;
      if (next === "cancelled") {
        const confirmed = window.confirm(
          "Mark this job as cancelled? The customer will not be charged and dispatch will see the cancellation."
        );
        if (!confirmed) return;
      }
      setError(null);
      startTransition(async () => {
        const result = await setStatus(appointmentId, next);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onChange(next, result.data.completed_at);
      });
    },
    [appointmentId, onChange, status]
  );

  return (
    <Section title="Status">
      {status === "completed" && completedAt && (
        <p className="mb-3 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-primary">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Completed at {formatSlotTime(completedAt)}
        </p>
      )}
      {status === "cancelled" && (
        <p className="mb-3 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-destructive">
          <XCircle className="h-3.5 w-3.5" />
          Cancelled
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <ActionButton
          tone={status === "completed" ? "primary-active" : "primary"}
          onClick={() => apply("completed")}
          disabled={pending}
        >
          <Check className="h-4 w-4" />
          {status === "completed" ? "Done" : "Mark done"}
        </ActionButton>
        <ActionButton
          tone={status === "cancelled" ? "destructive-active" : "ghost"}
          onClick={() => apply("cancelled")}
          disabled={pending}
        >
          <X className="h-4 w-4" />
          {status === "cancelled" ? "Cancelled" : "Cancel"}
        </ActionButton>
      </div>

      {status !== "booked" && (
        <button
          type="button"
          onClick={() => apply("booked")}
          disabled={pending}
          className="mt-2 text-[11px] text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
        >
          Re-open as booked
        </button>
      )}

      {error && <p className="mt-2 font-mono text-[11px] text-destructive">{error}</p>}
    </Section>
  );
}

function NotesBlock({
  appointmentId,
  value,
  onChange,
  disabled
}: {
  appointmentId: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  const [save, setSave] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const lastSavedRef = useRef<string>(value);
  const [, startTransition] = useTransition();

  const flush = useCallback(() => {
    if (value === lastSavedRef.current) return;
    setSave("saving");
    setError(null);
    startTransition(async () => {
      const result = await updateNotes(appointmentId, value);
      if (!result.ok) {
        setSave("error");
        setError(result.error);
        return;
      }
      lastSavedRef.current = value;
      setSave("saved");
    });
  }, [appointmentId, value]);

  // Reset the "Saved" badge after a couple of seconds.
  useEffect(() => {
    if (save !== "saved") return;
    const t = setTimeout(() => setSave("idle"), 2000);
    return () => clearTimeout(t);
  }, [save]);

  return (
    <Section
      title="Notes"
      right={
        save === "saving" ? (
          <SaveIndicator label="Saving…" />
        ) : save === "saved" ? (
          <SaveIndicator label="Saved" tone="primary" />
        ) : save === "error" ? (
          <SaveIndicator label="Save failed" tone="destructive" />
        ) : null
      }
    >
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={flush}
        disabled={disabled}
        rows={4}
        placeholder="What happened on-site, what to flag for next visit…"
        className={cn(
          "w-full resize-y border border-border bg-background px-3 py-2.5 text-[14px] leading-relaxed text-foreground placeholder:text-muted-foreground/60",
          "focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary",
          disabled && "cursor-not-allowed opacity-60"
        )}
      />
      {error && <p className="mt-1.5 font-mono text-[11px] text-destructive">{error}</p>}
    </Section>
  );
}

function PhotosBlock({
  appointmentId,
  photos,
  onAdded,
  disabled
}: {
  appointmentId: string;
  photos: JobPhoto[];
  onAdded: (photo: JobPhoto) => void;
  disabled: boolean;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pendingKindRef = useRef<PhotoKind>("before");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabaseRef = useRef<ReturnType<typeof createSupabaseBrowserClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createSupabaseBrowserClient();

  const trigger = (kind: PhotoKind) => {
    if (disabled || uploading) return;
    pendingKindRef.current = kind;
    fileRef.current?.click();
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so picking same file twice still fires
    if (!file) return;

    setError(null);
    setUploading(true);
    try {
      const ext = guessExtension(file);
      const photoId = crypto.randomUUID();
      const storagePath = `${appointmentId}/${photoId}.${ext}`;

      const upload = await supabaseRef.current!.storage
        .from("job-photos")
        .upload(storagePath, file, {
          contentType: file.type || "image/jpeg",
          upsert: false
        });
      if (upload.error) {
        setError(upload.error.message);
        return;
      }

      const result = await recordPhoto(appointmentId, storagePath, pendingKindRef.current);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onAdded(result.data);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Section
      title="Photos"
      right={
        uploading ? <SaveIndicator label="Uploading…" /> : null
      }
    >
      <div className="grid grid-cols-3 gap-2">
        {(["before", "after", "damage"] as PhotoKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => trigger(k)}
            disabled={disabled || uploading}
            className={cn(
              "flex flex-col items-center justify-center gap-1.5 border border-dashed border-border bg-card px-2 py-4 text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors",
              "active:bg-card/70 hover:border-foreground/40 hover:text-foreground",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            <Camera className="h-4 w-4" />
            <span className="font-mono">{k}</span>
          </button>
        ))}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFile}
      />

      {error && <p className="mt-2 font-mono text-[11px] text-destructive">{error}</p>}

      {photos.length > 0 && (
        <ul className="mt-3 grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <li key={p.id} className="relative aspect-square overflow-hidden border border-border bg-card">
              {/* Signed Supabase URLs are remote — use a plain img to skip next/image domain config. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.signed_url}
                alt={`${p.kind} photo`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-white">
                {p.kind}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function EscalateBlock({
  appointmentId,
  open,
  onOpen,
  onClose
}: {
  appointmentId: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState("");
  const [urgency, setUrgency] = useState<Urgency>("normal");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createEscalation(appointmentId, summary, urgency);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSubmitted(true);
      setSummary("");
      setUrgency("normal");
      setTimeout(() => {
        setSubmitted(false);
        onClose();
      }, 1500);
    });
  };

  if (submitted) {
    return (
      <Section title="Escalate">
        <p className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-primary">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Flagged for dispatch
        </p>
      </Section>
    );
  }

  if (!open) {
    return (
      <Section title="Escalate">
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full items-center justify-center gap-2 border border-urgency-normal/50 bg-card px-4 py-3 text-[13px] font-medium text-urgency-normal transition-colors active:bg-card/70 hover:border-urgency-normal"
        >
          <AlertTriangle className="h-4 w-4" />
          Flag for dispatch
        </button>
      </Section>
    );
  }

  return (
    <Section title="Escalate">
      <div className="space-y-2">
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
          placeholder="What does dispatch need to know?"
          className="w-full resize-y border border-border bg-background px-3 py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex items-center gap-2">
          {(["low", "normal", "high"] as Urgency[]).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUrgency(u)}
              className={cn(
                "flex-1 border px-3 py-2 text-[11px] font-mono uppercase tracking-[0.14em] transition-colors",
                urgency === u
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {u}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <ActionButton tone="primary" onClick={submit} disabled={pending || summary.trim().length < 3}>
            Send
          </ActionButton>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="flex-1 border border-border bg-background px-4 py-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {error && <p className="font-mono text-[11px] text-destructive">{error}</p>}
      </div>
    </Section>
  );
}

function Section({
  title,
  right,
  children
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-7">
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {title}
        </p>
        {right}
      </div>
      <div>{children}</div>
    </section>
  );
}

function SaveIndicator({
  label,
  tone = "muted"
}: {
  label: string;
  tone?: "muted" | "primary" | "destructive";
}) {
  return (
    <span
      className={cn(
        "font-mono text-[10px] uppercase tracking-[0.18em]",
        tone === "primary" && "text-primary",
        tone === "destructive" && "text-destructive",
        tone === "muted" && "text-muted-foreground"
      )}
    >
      {label}
    </span>
  );
}

function ActionButton({
  tone,
  onClick,
  disabled,
  children
}: {
  tone: "primary" | "primary-active" | "ghost" | "destructive-active";
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-2 border px-4 py-3 text-[13px] font-medium transition-colors",
        tone === "primary" &&
          "border-primary bg-transparent text-primary active:bg-primary/10 hover:bg-primary/10",
        tone === "primary-active" && "border-primary bg-primary text-primary-foreground",
        tone === "ghost" &&
          "border-border bg-background text-muted-foreground active:bg-card/70 hover:text-foreground",
        tone === "destructive-active" && "border-destructive bg-destructive text-destructive-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50"
      )}
    >
      {children}
    </button>
  );
}

function guessExtension(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && fromName.length <= 5) return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/heic") return "heic";
  return "jpg";
}
