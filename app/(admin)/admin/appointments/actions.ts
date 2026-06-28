"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";

export type AssignResult = { ok: true } | { ok: false; error: string };

export async function assignTechnician(
  appointmentId: string,
  technicianId: string | null
): Promise<AssignResult> {
  await requireRole("admin");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("appointments")
    .update({ assigned_technician_id: technicianId })
    .eq("id", appointmentId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/appointments");
  return { ok: true };
}
