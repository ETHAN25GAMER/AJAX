import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const maxDuration = 60;

// PDPA retention: delete WhatsApp chat logs that have been idle for longer than
// the retention window. We only drop the `conversations` row (the chat history
// in state_json) — appointments, escalations, and the customer record stay, so
// business history is untouched. If the customer messages again later, a fresh
// conversation is created automatically.
//
// Window is configurable but defaults to 6 months (the agreed policy).
const RETENTION_CONV_MONTHS = Number(process.env.RETENTION_CONV_MONTHS ?? 6);

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (expected && auth !== expected) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  if (!Number.isFinite(RETENTION_CONV_MONTHS) || RETENTION_CONV_MONTHS <= 0) {
    return NextResponse.json({ skipped: "retention disabled", months: RETENTION_CONV_MONTHS });
  }

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RETENTION_CONV_MONTHS);

  const db = supabase();
  const { error, count } = await db
    .from("conversations")
    .delete({ count: "exact" })
    .lt("last_message_at", cutoff.toISOString());

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    purged: count ?? 0,
    cutoff: cutoff.toISOString(),
    months: RETENTION_CONV_MONTHS
  });
}
