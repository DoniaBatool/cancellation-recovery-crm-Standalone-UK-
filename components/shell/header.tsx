import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileNav } from "@/components/shell/mobile-nav";
import { signOutAction } from "@/lib/auth-actions";
import type { Role } from "@/lib/constants";

const ROLE_LABELS: Record<Role, string> = { owner: "Owner", admin: "Admin", staff: "Staff" };

/** Top bar: clinic name, who is signed in (email + role) and a sign-out button. */
export function Header({ clinicName, email, role }: { clinicName: string; email: string | null; role: Role }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card px-4">
      <MobileNav />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{clinicName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {email ? `${email} · ` : ""}
          {ROLE_LABELS[role]}
        </p>
      </div>
      <form action={signOutAction}>
        <Button type="submit" variant="outline" size="sm">
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Sign out</span>
          <span className="sr-only sm:hidden">Sign out</span>
        </Button>
      </form>
    </header>
  );
}
