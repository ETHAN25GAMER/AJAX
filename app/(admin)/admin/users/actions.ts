"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase as serviceClient } from "@/lib/supabase/client";
import { requireRole } from "@/lib/auth/require-role";
import type { Role } from "@/lib/supabase/types";

export type ActionResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const RoleSchema = z.enum(["admin", "technician"]);

const InviteSchema = z.object({
  email: z.string().email("Enter a valid email").transform((s) => s.trim().toLowerCase()),
  role: RoleSchema
});

export async function updateUserRole(userId: string, role: Role): Promise<ActionResult> {
  const session = await requireRole("admin");
  if (session.userId === userId && role !== "admin") {
    return { ok: false, error: "You can't demote yourself. Have another admin do it." };
  }
  const parsed = RoleSchema.safeParse(role);
  if (!parsed.success) return { ok: false, error: "Invalid role" };

  const db = serviceClient();
  const { error } = await db.from("profiles").update({ role: parsed.data }).eq("id", userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/users");
  return { ok: true, value: undefined };
}

const NameSchema = z.string().max(80).nullable();

export async function updateUserName(
  userId: string,
  fullName: string | null
): Promise<ActionResult> {
  await requireRole("admin");
  const parsed = NameSchema.safeParse(fullName);
  if (!parsed.success) return { ok: false, error: "Name too long" };

  const trimmed = parsed.data && parsed.data.trim() !== "" ? parsed.data.trim() : null;

  const db = serviceClient();
  const { error } = await db.from("profiles").update({ full_name: trimmed }).eq("id", userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/users");
  return { ok: true, value: undefined };
}

export async function inviteUser(input: unknown): Promise<ActionResult<{ userId: string }>> {
  await requireRole("admin");
  const parsed = InviteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const db = serviceClient();
  const { data, error } = await db.auth.admin.inviteUserByEmail(parsed.data.email);
  if (error) return { ok: false, error: error.message };
  if (!data.user) return { ok: false, error: "Invite sent but no user returned." };

  // The on_auth_user_created trigger has already created the profile with
  // role='technician'. If admin selected 'admin', update it.
  if (parsed.data.role === "admin") {
    const { error: roleError } = await db
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", data.user.id);
    if (roleError) return { ok: false, error: roleError.message };
  }

  revalidatePath("/admin/users");
  return { ok: true, value: { userId: data.user.id } };
}
