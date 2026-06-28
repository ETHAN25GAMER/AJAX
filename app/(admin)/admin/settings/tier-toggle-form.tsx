"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { DeploymentTier } from "@/lib/supabase/types";
import { updateTier } from "./actions";

export function TierToggleForm({
  current,
  next,
  label
}: {
  current: DeploymentTier;
  next: DeploymentTier;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={() => {
        setError(null);
        startTransition(async () => {
          try {
            const result = await updateTier(next);
            if (!result.ok) setError(result.error);
          } catch (e) {
            // Without this, a rejected action leaves the button stuck on "Saving…"
            // with no feedback. Surface it instead.
            setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
          }
        });
      }}
    >
      <Button type="submit" disabled={pending} variant={next === "tier3" ? "default" : "outline"}>
        {pending ? "Saving…" : label}
      </Button>
      <input type="hidden" name="from" value={current} />
      {error && (
        <p className="mt-3 font-mono text-[11px] text-destructive">{error}</p>
      )}
    </form>
  );
}
