import { CalendarCheck } from "lucide-react";
import { NavLinks } from "@/components/shell/nav-links";

/** Desktop sidebar. Hidden on small screens, where the mobile drawer is used instead. */
export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-card md:block">
      <div className="sticky top-0">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <CalendarCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          <span className="text-base font-semibold text-primary">SlotRefill</span>
        </div>
        <NavLinks />
      </div>
    </aside>
  );
}
