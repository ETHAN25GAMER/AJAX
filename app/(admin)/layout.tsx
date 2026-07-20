import Link from "next/link";
import {
  LayoutDashboard,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Contact,
  FileClock,
  Megaphone,
  MessageSquare,
  Navigation,
  Route,
  Tag,
  Users,
  LogOut,
  type LucideIcon
} from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { signOut } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const nav: NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/escalations", label: "Escalations", icon: AlertTriangle },
  { href: "/admin/appointments", label: "Appointments", icon: CalendarDays },
  { href: "/admin/dispatch", label: "Dispatch", icon: Navigation },
  { href: "/admin/amc", label: "AMC", icon: FileClock },
  { href: "/admin/conversations", label: "Conversations", icon: MessageSquare },
  { href: "/admin/customers", label: "Customers", icon: Contact },
  { href: "/admin/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/admin/journeys", label: "Journeys", icon: Route },
  { href: "/admin/kpi", label: "KPI", icon: BarChart3 },
  { href: "/admin/pricing", label: "Pricing", icon: Tag },
  { href: "/admin/users", label: "Users", icon: Users }
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("admin");

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-60 shrink-0 border-r bg-card md:flex md:flex-col">
        <div className="flex h-14 items-center border-b px-4">
          <span className="text-base font-semibold">{BRAND.app}</span>
          <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
            admin
          </span>
        </div>

        <nav className="flex-1 space-y-0.5 p-2">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{label}</span>
            </Link>
          ))}
        </nav>

        <div className="border-t p-3 text-xs text-muted-foreground">
          <div className="mb-2 truncate">{session.email ?? session.userId}</div>
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm" className="w-full">
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </Button>
          </form>
        </div>
      </aside>

      <main className="flex-1">{children}</main>
    </div>
  );
}
