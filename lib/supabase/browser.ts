"use client";

import { createBrowserClient } from "@supabase/ssr";

// Anon-key Supabase client for "use client" components (e.g. the login form).
// Never import this from server code — use lib/supabase/server.ts instead.
//
// Memoized into a per-tab singleton. Every client component used to mint its own
// `createBrowserClient`, so a tab could hold half a dozen GoTrueClient instances
// all sharing the same storage key and racing each other to refresh the access
// token — which surfaces as "Multiple GoTrueClient instances detected" warnings
// and intermittent `_refreshAccessToken` "Failed to fetch" errors. One shared
// instance means one auth lock and one refresh timer.

// Wrapped in a factory so the cached type is inferred from the actual call
// expression — annotating with `ReturnType<typeof createBrowserClient>` directly
// resolves a broader overload and strips the typed realtime `.on()` payloads.
function makeBrowserClient(url: string, key: string) {
  return createBrowserClient(url, key);
}

let browserClient: ReturnType<typeof makeBrowserClient> | undefined;

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set");
  }
  // During the SSR pass `window` is undefined and modules are shared across
  // requests, so never cache there — hand back a throwaway instance. Only the
  // browser gets the long-lived singleton.
  if (typeof window === "undefined") {
    return makeBrowserClient(url, key);
  }
  if (!browserClient) browserClient = makeBrowserClient(url, key);
  return browserClient;
}
