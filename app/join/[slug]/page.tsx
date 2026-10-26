import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarCheck } from "lucide-react";
import { readDoctors } from "@/lib/doctors";
import { getAdminClient } from "@/lib/supabase/admin";
import { JoinForm } from "./join-form";

// Public page, no login (guide §9.9). The proxy skips /join. Read with the admin client, but
// only the clinic name and the dentist names are ever sent to the browser.
export const metadata: Metadata = { title: "Join our short-notice list", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) notFound();

  const admin = getAdminClient();
  const { data: clinic } = await admin
    .from("clinics")
    .select("id, name")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (!clinic) notFound();

  const { data: config } = await admin.from("clinic_config").select("doctors").eq("clinic_id", clinic.id).maybeSingle();
  const doctors = readDoctors(config?.doctors).map((d) => d.name);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-primary">
          <CalendarCheck className="h-6 w-6" aria-hidden="true" />
          <span className="text-lg font-semibold">{clinic.name}</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Join our short-notice list</h1>
        <p className="text-muted-foreground">We&apos;ll text you if an earlier appointment opens.</p>
      </header>
      <JoinForm slug={slug} clinicName={clinic.name} doctors={doctors} />
    </main>
  );
}
