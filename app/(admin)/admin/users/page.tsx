import { supabase as serviceClient } from "@/lib/supabase/client";
import { requireRole } from "@/lib/auth/require-role";
import type { Profile } from "@/lib/supabase/types";
import { UsersClient, type UserRow } from "./users-client";

export const metadata = { title: "Users" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await requireRole("admin");
  const db = serviceClient();

  // Service-role only: list auth.users to get emails + invite status, then
  // join with profiles (which carry the role and display name).
  const [authResult, profilesResult] = await Promise.all([
    db.auth.admin.listUsers({ perPage: 200 }),
    db.from("profiles").select("*").order("created_at", { ascending: true })
  ]);

  if (authResult.error || profilesResult.error) {
    return (
      <div className="surface-paper min-h-dvh px-6 py-16 md:px-12">
        <div className="mx-auto max-w-2xl border border-destructive/40 bg-card px-6 py-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-destructive">
            Database error
          </p>
          <p className="mt-2 text-sm text-foreground">
            {authResult.error?.message ?? profilesResult.error?.message ?? ""}
          </p>
        </div>
      </div>
    );
  }

  const profilesById = new Map<string, Profile>();
  for (const p of (profilesResult.data ?? []) as Profile[]) profilesById.set(p.id, p);

  const users: UserRow[] = (authResult.data.users ?? []).map((u) => {
    const profile = profilesById.get(u.id);
    return {
      id: u.id,
      email: u.email ?? null,
      created_at: u.created_at ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
      invited_at: u.invited_at ?? null,
      confirmed: !!u.email_confirmed_at,
      role: profile?.role ?? "technician",
      full_name: profile?.full_name ?? null,
      phone: profile?.phone ?? null
    };
  });

  // Sort: admins first, then by created_at ascending.
  users.sort((a, b) => {
    if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
    if (!a.created_at || !b.created_at) return 0;
    return a.created_at < b.created_at ? -1 : 1;
  });

  return <UsersClient initial={users} currentUserId={session.userId} />;
}
