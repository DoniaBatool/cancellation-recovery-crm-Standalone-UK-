"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildMonthlyReport, MONTH_RE, saveMonthlyReport } from "@/lib/reports";
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Rebuilds the month from live data and replaces the saved snapshot. RLS keeps it to the signed-in clinic. */
export async function saveReportAction(formData: FormData) {
  const month = String(formData.get("month") ?? "");
  if (!MONTH_RE.test(month)) redirect("/reports");
  const { clinic } = await requireSession();
  const db = await createSupabaseServerClient();
  await saveMonthlyReport(db, clinic.id, await buildMonthlyReport(db, clinic, month));
  revalidatePath("/reports");
  redirect(`/reports?month=${month}`);
}
