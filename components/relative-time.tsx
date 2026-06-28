"use client";

import { useEffect, useState } from "react";
import { absShort, shortAgo } from "@/lib/time";

type Props = {
  iso: string;
  /** Optional leading text, e.g. "Last update · ". */
  prefix?: string;
  className?: string;
  /** Render as a semantic <time> element with a dateTime attribute. */
  as?: "span" | "time";
};

/**
 * Live "x ago" timestamp that hydrates cleanly.
 *
 * The server and the first client render both emit the deterministic
 * Singapore-time absolute label (`absShort`), so the HTML matches and React
 * hydrates without warnings. Only after mount do we swap to the live "x ago"
 * form and refresh it every 30s. `suppressHydrationWarning` is belt-and-braces.
 */
export function RelativeTime({ iso, prefix = "", className, as = "span" }: Props) {
  const [label, setLabel] = useState(() => absShort(iso));

  useEffect(() => {
    const update = () => setLabel(shortAgo(iso));
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [iso]);

  const content = `${prefix}${label}`;

  if (as === "time") {
    return (
      <time dateTime={iso} className={className} suppressHydrationWarning>
        {content}
      </time>
    );
  }
  return (
    <span className={className} suppressHydrationWarning>
      {content}
    </span>
  );
}
