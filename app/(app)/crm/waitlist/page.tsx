import type { Metadata } from "next";
import { readDoctors } from "@/lib/doctors";
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { WaitlistView } from "./waitlist-view";

export const metadata: Metadata = { title: "Waitlist" };

export default async function WaitlistPage() {
  const { clinic } = await requireSession();
  const supabase = await createSupabaseServerClient();

  const [{ data: rows }, { data: config }] = await Promise.all([
    supabase
      .from("waitlist")
      .select(
        "id, patient_name, email, phone, preferred_procedures, preferred_days, preferred_times, preferred_doctors, max_notice_hours, existing_patient, notes, is_active, sms_opt_out, opt_in_source, last_contacted_at",
      )
      .eq("clinic_id", clinic.id)
      .order("created_at", { ascending: false }),
    supabase.from("clinic_config").select("doctors").eq("clinic_id", clinic.id).maybeSingle(),
  ]);

  return <WaitlistView rows={rows ?? []} doctors={readDoctors(config?.doctors)} timezone={clinic.timezone} />;
}
