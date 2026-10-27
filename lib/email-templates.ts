import { formatDayTime, formatGBP, formatSlot, formatTime } from "@/lib/format";

// Email copy. Source: SYSTEM_BUILD_GUIDE.md §10.1.
// Every email has a plain-text version plus simple inline-styled HTML (Arial, 15 px, navy button,
// white text, 6 px radius). All values are HTML-escaped. Pure functions: no sending here.

export type EmailContent = { subject: string; text: string; html: string };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const NAVY = "#1e3a5f";

type Block = { kind: "p"; text: string } | { kind: "button"; label: string; url: string } | { kind: "small"; text: string };

const p = (text: string): Block => ({ kind: "p", text });
const small = (text: string): Block => ({ kind: "small", text });
const button = (label: string, url: string): Block => ({ kind: "button", label, url });

/** Build the HTML and plain-text bodies from the same blocks, so they never drift apart. */
function render(subject: string, blocks: Block[]): EmailContent {
  const text = blocks
    .map((b) => (b.kind === "button" ? `${b.label}: ${b.url}` : b.text))
    .join("\n\n");
  const body = blocks
    .map((b) => {
      if (b.kind === "button") {
        return (
          `<p style="margin:20px 0;"><a href="${escapeHtml(b.url)}" ` +
          `style="background:${NAVY};color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:bold;">` +
          `${escapeHtml(b.label)}</a></p>`
        );
      }
      const style = b.kind === "small" ? "margin:0 0 12px;font-size:13px;color:#475569;" : "margin:0 0 12px;";
      return `<p style="${style}">${escapeHtml(b.text).replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
  const html =
    `<!doctype html><html><body style="margin:0;padding:16px;background:#ffffff;">` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#0f172a;max-width:560px;">${body}</div>` +
    `</body></html>`;
  return { subject, text, html };
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const shortName = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return parts.length < 2 ? (parts[0] ?? name) : `${parts[0]} ${parts[parts.length - 1]!.charAt(0).toUpperCase()}.`;
};
const a = (procedure: string | null) => (procedure ? procedure.toLowerCase() : "appointment");

export type SlotOfferEmailInput = {
  clinicName: string;
  timeZone: string;
  patientName: string;
  procedure: string | null;
  dentist: string | null;
  slotDatetime: string;
  expiresAt: string;
  expiryMinutes: number;
  link: string;
  /** True when the slot dentist is not the patient's preferred one. */
  differentDentist: boolean;
};

export function slotOfferEmail(i: SlotOfferEmailInput): EmailContent {
  const when = formatSlot(i.slotDatetime, i.timeZone);
  const who = i.dentist ? ` with ${i.dentist}` : "";
  const blocks: Block[] = [
    p(`Hi ${firstName(i.patientName)},`),
    p(
      `A ${a(i.procedure)} appointment${who} has just become available on ${when}. ` +
        `It's held for you for ${i.expiryMinutes} minutes (until ${formatTime(i.expiresAt, i.timeZone)}).`,
    ),
    button("Answer now", i.link),
  ];
  if (i.differentDentist && i.dentist) {
    blocks.push(p(`Please note this slot is with ${i.dentist}, who is not your usual dentist.`));
  }
  blocks.push(small(`${i.clinicName}. If you no longer want these messages, reply to this email.`));
  return render(`Earlier appointment available — ${when}`, blocks);
}

export type ApprovalRequestEmailInput = {
  timeZone: string;
  patientName: string;
  patientPhone: string | null;
  procedure: string | null;
  dentist: string | null;
  slotDatetime: string;
  price: number | null;
  approvalWindowMinutes: number;
  link: string;
};

export function approvalRequestEmail(i: ApprovalRequestEmailInput): EmailContent {
  const lines = [
    `Patient: ${i.patientName}${i.patientPhone ? ` (${i.patientPhone})` : ""}`,
    `Slot: ${formatSlot(i.slotDatetime, i.timeZone)}`,
    `Treatment: ${i.procedure ?? "Not specified"}`,
    `Dentist: ${i.dentist ?? "Not specified"}`,
    ...(i.price !== null ? [`Value: ${formatGBP(i.price)}`] : []),
  ];
  return render(`${shortName(i.patientName)} said YES — approve ${formatDayTime(i.slotDatetime, i.timeZone)}?`, [
    p(`${shortName(i.patientName)} said YES to the appointment that came free.`),
    p(lines.join("\n")),
    button("Approve", i.link),
    small(`Please approve within ${i.approvalWindowMinutes} minutes. You will need to be signed in to the CRM.`),
  ]);
}

export type PatientConfirmationEmailInput = {
  clinicName: string;
  clinicAddress: string | null;
  clinicPhone: string | null;
  timeZone: string;
  patientName: string;
  procedure: string | null;
  dentist: string | null;
  slotDatetime: string;
};

export function patientConfirmationEmail(i: PatientConfirmationEmailInput): EmailContent {
  const lines = [
    `When: ${formatSlot(i.slotDatetime, i.timeZone)}`,
    ...(i.dentist ? [`Dentist: ${i.dentist}`] : []),
    ...(i.procedure ? [`Appointment: ${i.procedure}`] : []),
    ...(i.clinicAddress ? [`Where: ${i.clinicName}, ${i.clinicAddress}`] : [`Where: ${i.clinicName}`]),
    ...(i.clinicPhone ? [`Phone: ${i.clinicPhone}`] : []),
  ];
  return render(`Your appointment is confirmed — ${i.clinicName}`, [
    p(`Hi ${firstName(i.patientName)},`),
    p("Your appointment is confirmed."),
    p(lines.join("\n")),
    p(`If you can't make it, please call us${i.clinicPhone ? ` on ${i.clinicPhone}` : ""}.`),
  ]);
}

export type DoctorNotificationEmailInput = {
  timeZone: string;
  patientName: string;
  patientPhone: string | null;
  patientEmail: string | null;
  procedure: string | null;
  slotDatetime: string;
  cancelledPatientName: string | null;
};

export function doctorNotificationEmail(i: DoctorNotificationEmailInput): EmailContent {
  const when = formatSlot(i.slotDatetime, i.timeZone);
  const lines = [
    `Patient: ${i.patientName}`,
    ...(i.patientPhone ? [`Phone: ${i.patientPhone}`] : []),
    ...(i.patientEmail ? [`Email: ${i.patientEmail}`] : []),
    `When: ${when}`,
    `Treatment: ${i.procedure ?? "Not specified"}`,
  ];
  const blocks: Block[] = [p("A cancelled slot has been filled from the waitlist."), p(lines.join("\n"))];
  if (i.cancelledPatientName) blocks.push(p(`This replaces the cancelled appointment of ${i.cancelledPatientName}.`));
  return render(`New appointment: ${i.patientName} — ${when}`, blocks);
}

export type SlotExpiredAlertEmailInput = {
  timeZone: string;
  procedure: string | null;
  dentist: string | null;
  slotDatetime: string;
  offeredCount: number;
  reason: string;
  link: string;
};

export function slotExpiredAlertEmail(i: SlotExpiredAlertEmailInput): EmailContent {
  const lines = [
    `Slot: ${formatSlot(i.slotDatetime, i.timeZone)}`,
    `Treatment: ${i.procedure ?? "Not specified"}`,
    `Dentist: ${i.dentist ?? "Not specified"}`,
    `Reason: ${i.reason}`,
  ];
  return render("Slot still unfilled — manual follow-up needed", [
    p("This slot was not filled from the waitlist."),
    p(lines.join("\n")),
    p(`${i.offeredCount} waitlist ${i.offeredCount === 1 ? "patient was" : "patients were"} offered.`),
    button("Open the CRM", i.link),
  ]);
}

/** Shadow mode: mark an email as a test copy for the named patient. */
export function withTestPrefix(content: EmailContent, patientName: string): EmailContent {
  const tag = `[TEST for ${patientName}]`;
  return {
    subject: `${tag} ${content.subject}`,
    text: `${tag}\n\n${content.text}`,
    html: content.html.replace(
      /(<div style="[^"]*">)/,
      `$1<p style="margin:0 0 12px;font-weight:bold;color:#b45309;">${escapeHtml(tag)}</p>`,
    ),
  };
}

export type OperatorAlertInput = { clinicName: string; alerts: string[]; link: string };

/** For the person who runs the system (OPERATOR_ALERT_EMAIL), not for the clinic. */
export function operatorAlertEmail(i: OperatorAlertInput): EmailContent {
  return render(`[SlotRefill] ${i.clinicName}: attention needed`, [
    p(`${i.clinicName} needs a look:`),
    p(i.alerts.map((a) => `- ${a}`).join("\n")),
    button("Open the CRM", i.link),
  ]);
}
