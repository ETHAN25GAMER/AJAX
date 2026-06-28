import Link from "next/link";
import { ClipboardList, AlertTriangle, User } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { BRAND } from "@/lib/brand";

const nav = [
  { href: "/tech", label: "Today", icon: ClipboardList },
  { href: "/tech/escalations", label: "Alerts", icon: AlertTriangle },
  { href: "/tech/me", label: "Me", icon: User }
];

export default async function TechLayout({ children }: { children: React.ReactNode }) {
  await requireRole("technician");

  return (
    <div className="flex min-h-dvh flex-col md:bg-card/40">
      <main className="flex-1 pb-20 md:mx-auto md:w-full md:max-w-md md:border-x md:border-border md:bg-background">
        <header className="flex h-14 items-center border-b border-border px-4">
          <span className="text-base font-semibold">{BRAND.app}</span>
          <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
            technician
          </span>
        </header>
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-10 pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto flex max-w-md items-stretch justify-around border-t border-border bg-card md:border-x md:border-border">
          {nav.map(({ href, label, icon: Icon }) => (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className="flex flex-col items-center gap-1 py-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
