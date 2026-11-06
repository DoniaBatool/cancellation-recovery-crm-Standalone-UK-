import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatGBP, formatPercent } from "@/lib/format";
import { formatMonth, reportProcedureLabel, type MonthlyReportData } from "@/lib/reports";
import { formatDuration } from "@/lib/time";

// A PDF cannot read the CSS tokens, so the palette is mirrored here (guide §11: navy, calm, no gradients).
const NAVY = "#1e3a5f";
const MUTED = "#475569";
const LINE = "#e2e8f0";
const SUCCESS = "#15803d";

const s = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 10, color: "#0f172a" },
  title: { fontSize: 22, color: NAVY, fontFamily: "Helvetica-Bold" },
  sub: { marginTop: 4, color: MUTED },
  grid: { flexDirection: "row", flexWrap: "wrap", marginTop: 22, marginHorizontal: -5 },
  tile: { width: "33.33%", padding: 5 },
  tileInner: { border: `1pt solid ${LINE}`, borderRadius: 4, padding: 12 },
  tileLabel: { fontSize: 9, color: MUTED },
  tileValue: { marginTop: 4, fontSize: 20, fontFamily: "Helvetica-Bold", color: NAVY },
  h2: { marginTop: 24, marginBottom: 8, fontSize: 13, color: NAVY, fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row", borderBottom: `1pt solid ${LINE}`, paddingVertical: 6 },
  head: { backgroundColor: "#f1f5f9" },
  c1: { width: "40%", paddingLeft: 6 },
  cn: { width: "20%", textAlign: "right", paddingRight: 6 },
  note: { marginTop: 24, fontSize: 8.5, color: MUTED, lineHeight: 1.5 },
  footer: { position: "absolute", left: 40, right: 40, bottom: 24, fontSize: 8, color: MUTED, flexDirection: "row", justifyContent: "space-between" },
});

function Tile({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <View style={s.tile}>
      <View style={s.tileInner}>
        <Text style={s.tileLabel}>{label}</Text>
        <Text style={green ? [s.tileValue, { color: SUCCESS }] : s.tileValue}>{value}</Text>
      </View>
    </View>
  );
}

export function MonthlyReportDocument({ report }: { report: MonthlyReportData }) {
  const title = formatMonth(report.month);
  const generated = new Intl.DateTimeFormat("en-GB", { timeZone: report.timezone, day: "numeric", month: "long", year: "numeric" }).format(
    new Date(report.generated_at),
  );
  return (
    <Document title={`${report.clinic_name} - Monthly recovery report - ${title}`} author="SlotRefill">
      <Page size="A4" style={s.page}>
        <Text style={s.title}>Monthly recovery report</Text>
        <Text style={s.sub}>
          {report.clinic_name} · {title}
        </Text>

        <View style={s.grid}>
          <Tile label="Gaps (cancellations) found" value={String(report.gaps)} />
          <Tile label="Offers sent" value={String(report.offers_sent)} />
          <Tile label="Slots filled" value={String(report.filled)} />
          <Tile label="Fill rate" value={formatPercent(report.fill_rate)} />
          <Tile label="Revenue recovered" value={formatGBP(report.revenue_recovered)} green />
          <Tile label="Average fill time" value={report.avg_fill_minutes === null ? "-" : formatDuration(report.avg_fill_minutes)} />
        </View>

        <Text style={s.h2}>By treatment</Text>
        <View style={[s.row, s.head]}>
          <Text style={s.c1}>Treatment</Text>
          <Text style={s.cn}>Gaps</Text>
          <Text style={s.cn}>Filled</Text>
          <Text style={s.cn}>Recovered</Text>
        </View>
        {report.by_procedure.length === 0 ? (
          <Text style={{ padding: 8, color: MUTED }}>No cancellations were recorded this month.</Text>
        ) : (
          report.by_procedure.map((p) => (
            <View key={p.procedure} style={s.row} wrap={false}>
              <Text style={s.c1}>{reportProcedureLabel(p.procedure)}</Text>
              <Text style={s.cn}>{p.gaps}</Text>
              <Text style={s.cn}>{p.filled}</Text>
              <Text style={s.cn}>{formatGBP(p.revenue)}</Text>
            </View>
          ))
        )}

        <Text style={s.note}>
          Basis: every gap detected in {title}, and what became of it. Fill rate = slots filled ÷ gaps found. Of the {report.gaps} gaps, {report.filled} were
          filled, {report.expired} expired or were handled manually and {report.still_open} were still open when this report was generated. Revenue
          recovered is the treatment value of the filled slots.
        </Text>

        <View style={s.footer} fixed>
          <Text>SlotRefill · Generated {generated}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderMonthlyReportPdf(report: MonthlyReportData): Promise<Buffer> {
  return renderToBuffer(<MonthlyReportDocument report={report} />);
}
