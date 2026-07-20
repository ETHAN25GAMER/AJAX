import { NextResponse } from "next/server";

// Bearer-token gate for /api/cron/*. Fails CLOSED in production: if
// CRON_SECRET is not configured the routes refuse to run rather than being
// publicly triggerable — they send customer-facing WhatsApp messages and
// delete data. (Vercel attaches `Authorization: Bearer $CRON_SECRET` to cron
// invocations automatically when the env var is set.)
export function requireCronAuth(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("CRON_SECRET not configured", { status: 503 });
    }
    return null; // local dev convenience
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return null;
}
