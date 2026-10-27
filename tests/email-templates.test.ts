import { describe, expect, it } from "vitest";
import {
  approvalRequestEmail,
  doctorNotificationEmail,
  escapeHtml,
  patientConfirmationEmail,
  slotExpiredAlertEmail,
  slotOfferEmail,
  withTestPrefix,
} from "@/lib/email-templates";

const SLOT = "2026-10-27T14:30:00Z"; // Tue, GMT

describe("escapeHtml", () => {
  it("escapes the five dangerous characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});

describe("slotOfferEmail", () => {
  const base = {
    clinicName: "Smile Dentals",
    timeZone: "Europe/London",
    patientName: "Sarah Khan",
    procedure: "Filling",
    dentist: "Dr Ali",
    slotDatetime: SLOT,
    expiresAt: "2026-10-26T10:30:00Z",
    expiryMinutes: 30,
    link: "https://app.example.com/confirm/abc",
    differentDentist: false,
  };

  it("has the guide subject and the answer button", () => {
    const mail = slotOfferEmail(base);
    expect(mail.subject).toBe("Earlier appointment available — Tue 27 Oct, 14:30");
    expect(mail.text).toContain("Hi Sarah,");
    expect(mail.text).toContain("held for you for 30 minutes (until 10:30)");
    expect(mail.text).toContain("Answer now: https://app.example.com/confirm/abc");
    expect(mail.html).toContain('href="https://app.example.com/confirm/abc"');
    expect(mail.html).toContain("#1e3a5f");
  });

  it("mentions the other dentist only when it applies", () => {
    expect(slotOfferEmail(base).text).not.toContain("not your usual dentist");
    expect(slotOfferEmail({ ...base, differentDentist: true }).text).toContain("Dr Ali, who is not your usual dentist");
  });

  it("escapes patient-controlled values in the HTML", () => {
    const mail = slotOfferEmail({ ...base, patientName: "<script>alert(1)</script>", link: 'https://x.com/"onmouseover=' });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain('"onmouseover=');
  });

  it("copes with no procedure or dentist", () => {
    const mail = slotOfferEmail({ ...base, procedure: null, dentist: null });
    expect(mail.text).toContain("A appointment");
  });
});

describe("approvalRequestEmail", () => {
  it("names the patient, the slot, the value and the approval window", () => {
    const mail = approvalRequestEmail({
      timeZone: "Europe/London",
      patientName: "Sarah Khan",
      patientPhone: "+447700900001",
      procedure: "Crown",
      dentist: "Dr Ali",
      slotDatetime: SLOT,
      price: 650,
      approvalWindowMinutes: 30,
      link: "https://app.example.com/approve/t",
    });
    expect(mail.subject).toBe("Sarah K. said YES — approve Tue 14:30?");
    expect(mail.text).toContain("£650");
    expect(mail.text).toContain("+447700900001");
    expect(mail.text).toContain("within 30 minutes");
    expect(mail.html).toContain("/approve/t");
  });

  it("leaves out the value when there is no price", () => {
    const mail = approvalRequestEmail({
      timeZone: "Europe/London",
      patientName: "Sam",
      patientPhone: null,
      procedure: null,
      dentist: null,
      slotDatetime: SLOT,
      price: null,
      approvalWindowMinutes: 30,
      link: "https://x/approve/t",
    });
    expect(mail.text).not.toContain("Value:");
  });
});

describe("confirmation and alert emails", () => {
  it("confirms the appointment with the clinic phone", () => {
    const mail = patientConfirmationEmail({
      clinicName: "Smile Dentals",
      clinicAddress: "1 High St",
      clinicPhone: "020 0000 0000",
      timeZone: "Europe/London",
      patientName: "Sarah Khan",
      procedure: "Filling",
      dentist: "Dr Ali",
      slotDatetime: SLOT,
    });
    expect(mail.subject).toBe("Your appointment is confirmed — Smile Dentals");
    expect(mail.text).toContain("call us on 020 0000 0000");
    expect(mail.text).toContain("1 High St");
  });

  it("tells the doctor who the slot replaces", () => {
    const mail = doctorNotificationEmail({
      timeZone: "Europe/London",
      patientName: "Sarah Khan",
      patientPhone: "+447700900001",
      patientEmail: "s@example.com",
      procedure: "Filling",
      slotDatetime: SLOT,
      cancelledPatientName: "Tom Lee",
    });
    expect(mail.subject).toBe("New appointment: Sarah Khan — Tue 27 Oct, 14:30");
    expect(mail.text).toContain("replaces the cancelled appointment of Tom Lee");
  });

  it("alerts reception with the number of patients offered", () => {
    const one = slotExpiredAlertEmail({ timeZone: "Europe/London", procedure: "Filling", dentist: null, slotDatetime: SLOT, offeredCount: 1, reason: "nobody accepted", link: "https://x/crm" });
    expect(one.subject).toBe("Slot still unfilled — manual follow-up needed");
    expect(one.text).toContain("1 waitlist patient was offered");
    const three = slotExpiredAlertEmail({ timeZone: "Europe/London", procedure: null, dentist: null, slotDatetime: SLOT, offeredCount: 3, reason: "x", link: "https://x/crm" });
    expect(three.text).toContain("3 waitlist patients were offered");
  });
});

describe("withTestPrefix", () => {
  it("marks subject, text and html", () => {
    const mail = withTestPrefix({ subject: "S", text: "T", html: '<div style="a">B</div>' }, "Sarah Khan");
    expect(mail.subject).toBe("[TEST for Sarah Khan] S");
    expect(mail.text.startsWith("[TEST for Sarah Khan]")).toBe(true);
    expect(mail.html).toContain("[TEST for Sarah Khan]");
  });
});
