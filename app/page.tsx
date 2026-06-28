import Link from "next/link";
import { redirect } from "next/navigation";
import { getOptionalSession } from "@/lib/auth/require-role";
import { BRAND } from "@/lib/brand";

export default async function Home() {
  const session = await getOptionalSession();
  if (session) {
    redirect(session.profile.role === "admin" ? "/admin" : "/tech");
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{BRAND.app}</h1>
      <p className="mt-3 text-muted-foreground">
        WhatsApp pest control agent. Webhook lives at <code className="rounded bg-muted px-1.5 py-0.5 text-sm">/api/whatsapp/webhook</code>.
      </p>
      <p className="mt-6">
        <Link className="text-primary underline underline-offset-4" href="/login">
          Staff sign-in
        </Link>
      </p>
    </main>
  );
}
