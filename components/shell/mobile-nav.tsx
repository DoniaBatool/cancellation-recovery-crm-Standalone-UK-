"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { NavLinks } from "@/components/shell/nav-links";

/** Menu button + drawer for screens narrower than the desktop sidebar. */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Open menu"
        className="inline-flex h-10 w-10 items-center justify-center rounded-md text-foreground transition-colors duration-200 hover:bg-accent md:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </SheetTrigger>
      <SheetContent title="Menu">
        <NavLinks onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
