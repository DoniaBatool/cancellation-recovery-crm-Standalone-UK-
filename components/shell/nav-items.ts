import { Activity, Columns3, FileText, LayoutDashboard, Settings, UserCog, Users, type LucideIcon } from "lucide-react";

// Guide §9: Dashboard, Pipeline, Waitlist, Activity, Settings, Team. "Reports" was added later (monthly reports + PDF).
export type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/crm", label: "Pipeline", icon: Columns3 },
  { href: "/crm/waitlist", label: "Waitlist", icon: Users },
  { href: "/crm/activity", label: "Activity", icon: Activity },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/crm/config", label: "Settings", icon: Settings },
  { href: "/crm/team", label: "Team", icon: UserCog },
];

/** True when `pathname` is this item's page (or inside it). "/crm" only matches itself and patient pages. */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/crm") return pathname === "/crm" || pathname.startsWith("/crm/patient");
  return pathname === href || pathname.startsWith(`${href}/`);
}
