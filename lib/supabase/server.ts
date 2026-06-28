import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

// Anon-key Supabase client for server components, route handlers, and Server Actions.
// Reads + writes the auth cookie via Next's cookie store so SSR sees the logged-in user.
// Keep this strictly separate from lib/supabase/client.ts (service-role, bypasses RLS).
export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set");
  }

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options as CookieOptions)
          );
        } catch {
          // setAll throws when called from a Server Component. The middleware
          // refreshes the session on every request, so this is safe to swallow.
        }
      }
    }
  });
}
