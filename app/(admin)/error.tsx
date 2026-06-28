"use client";

// Error boundary for the whole admin console. Without this, any thrown error in a
// server component or server action (e.g. a slow/aborted tier toggle, an expired
// session mid-action) white-screens the entire site. With it, the admin shell stays
// usable and the user can retry.
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AdminError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaces in the server/Vercel logs for triage.
    console.error("Admin console error:", error);
  }, [error]);

  return (
    <div className="surface-paper flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-lg border border-border bg-card p-6 md:p-8">
        <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-destructive">
          <AlertTriangle className="h-3 w-3" />
          Something went wrong
        </p>
        <h1 className="mt-3 font-serif text-3xl text-ink md:text-4xl">
          This page hit an error.
        </h1>
        <p className="mt-3 text-[14px] text-muted-foreground">
          The rest of the console is fine. Try again — if it keeps happening, reload
          the page or sign out and back in.
        </p>
        {error.digest && (
          <p className="mt-4 font-mono text-[11px] text-muted-foreground">
            Ref: {error.digest}
          </p>
        )}
        <div className="mt-6 flex gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button variant="outline" onClick={() => window.location.assign("/admin")}>
            Back to overview
          </Button>
        </div>
      </div>
    </div>
  );
}
