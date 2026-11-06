import { describe, expect, it } from "vitest";
import { renderMonthlyReportPdf } from "@/lib/report-pdf";
import { computeMonthlyReport } from "@/lib/reports";

describe("renderMonthlyReportPdf", () => {
  it("returns a real PDF for a month with data", async () => {
    const report = computeMonthlyReport(
      [
        {
          stage: "slot_recovered",
          revenue_saved: 150,
          created_at: "2026-09-10T09:00:00Z",
          detected_at: "2026-09-10T09:00:00Z",
          offer_sent_at: "2026-09-10T09:05:00Z",
          confirmed_at: "2026-09-10T09:35:00Z",
          procedure_type: "cleaning",
        },
      ],
      "2026-09",
      "Smile Clinic",
      "Europe/London",
      new Date("2026-10-02T10:00:00Z"),
    );
    const pdf = await renderMonthlyReportPdf(report);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("renders an empty month without throwing", async () => {
    const empty = computeMonthlyReport([], "2026-09", "Smile Clinic", "Europe/London", new Date("2026-10-02T10:00:00Z"));
    const pdf = await renderMonthlyReportPdf(empty);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
