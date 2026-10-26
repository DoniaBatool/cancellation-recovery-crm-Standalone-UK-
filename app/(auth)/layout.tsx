import { CalendarCheck } from "lucide-react";

// Centred card used by login, forgot-password, set-password and no-access.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2 text-primary">
        <CalendarCheck className="h-6 w-6" aria-hidden="true" />
        <span className="text-lg font-semibold">SlotRefill</span>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
