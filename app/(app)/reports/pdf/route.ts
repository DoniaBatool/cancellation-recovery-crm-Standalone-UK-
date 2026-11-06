import { renderMonthlyReportPdf } from "@/lib/report-pdf";
import { currentMonth, loadMonthlyReport, parseMonth } from "@/lib/reports";
import { getSessionContext } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Real PDF of one month's report (?month=YYYY-MM). Closed months come from the saved snapshot. */
export async function GET(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return new Response("Sign in to download reports.", { status: 401 });
  const { clinic } = ctx;
  const month = parseMonth(new URL(request.url).searchParams.get("month") ?? undefined, currentMonth(clinic.timezone));
  const db = await createSupabaseServerClient();
  const { data } = await loadMonthlyReport(db, clinic, month);
  const pdf = await renderMonthlyReportPdf(data);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${clinic.slug}-report-${month}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
