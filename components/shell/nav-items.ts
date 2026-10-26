import { Activity, Columns3, LayoutDashboard, Settings, UserCog, Users, type LucideIcon } from "lucide-react";

// Guide §9: Dashboard, Pipeline, Waitlist, Activity, Settings, Team.
export type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/crm", label: "Pipeline", icon: Columns3 },
  { href: "/crm/waitlist", label: "Waitlist", icon: Users },
  { href: "/crm/activity", label: "Activity", icon: Activity },
  { href: "/crm/config", label: "Settings", icon: Settings },
  { href: "/crm/team", label: "Team", icon: UserCog },
];

/** True when `pathname` is this item's page (or inside it). "/crm" only matches itself and patient pages. */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/crm") return pathname === "/crm" || pathname.startsWith("/crm/patient");
  return pathname === href || pathname.startsWith(`${href}/`);
}
