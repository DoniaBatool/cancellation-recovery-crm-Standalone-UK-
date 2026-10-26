import { Sidebar } from "@/components/shell/sidebar";
import { Header } from "@/components/shell/header";
import { requireSession } from "@/lib/session";

// Logged-in shell: sidebar on desktop, drawer on mobile. proxy.ts already redirects
// logged-out visitors; requireSession() is the second check (and handles "no clinic").
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, role, clinic } = await requireSession();

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header clinicName={clinic.name} email={user.email} role={role} />
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
