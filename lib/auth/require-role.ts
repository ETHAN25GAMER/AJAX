import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/supabase/types";

export type Session = {
  userId: string;
  email: string | null;
  profile: Profile;
};

// Defense-in-depth: middleware already gates the route by role, RLS gates the data,
// and this runs at the top of (admin)/layout.tsx and (tech)/layout.tsx so a server
// component can never render with the wrong role even if middleware is misconfigured.
export async function requireRole(role: Role): Promise<Session> {
  const supabase = await createSupabaseServerClient();
  const { data: userResult } = await supabase.auth.getUser();
  const user = userResult.user;
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  if (!profile) redirect("/login?error=no-profile");
  if (profile.role !== role) redirect(profile.role === "admin" ? "/admin" : "/tech");

  return { userId: user.id, email: user.email ?? null, profile };
}

export async function getOptionalSession(): Promise<Session | null> {
  const supabase = await createSupabaseServerClient();
  const { data: userResult } = await supabase.auth.getUser();
  const user = userResult.user;
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  if (!profile) return null;
  return { userId: user.id, email: user.email ?? null, profile };
}
