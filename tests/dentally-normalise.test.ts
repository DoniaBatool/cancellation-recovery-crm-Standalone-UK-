import { describe, expect, it } from "vitest";
import { isCancelledAppointment, mapProcedure, normaliseAppointment } from "@/lib/dentally/normalise";

describe("mapProcedure", () => {
  it.each([
    ["Hygiene appointment", "cleaning"], ["Scale and polish", "cleaning"], ["Routine check-up", "consultation"], ["New patient exam", "consultation"],
    ["Composite filling", "filling"], ["Wisdom tooth extraction", "extraction"], ["Crown prep", "crown"], ["Implant review", "implant"], ["Teeth whitening", "whitening"],
    ["Something unusual", null], ["", null], [null, null],
  ])("%s -> %s", (text, expected) => {
    expect(mapProcedure(text)).toBe(expected);
  });
});

describe("isCancelledAppointment", () => {
  it("reads the cancelled flag or a state containing 'cancel'", () => {
    expect(isCancelledAppointment({ cancelled: true })).toBe(true);
    expect(isCancelledAppointment({ state: "Cancelled" })).toBe(true);
    expect(isCancelledAppointment({ status: "cancelled_by_patient" })).toBe(true);
  });
  it("is false for other states, including a missed appointment", () => {
    expect(isCancelledAppointment({ state: "Confirmed" })).toBe(false);
    expect(isCancelledAppointment({ state: "Did not attend" })).toBe(false);
    expect(isCancelledAppointment({})).toBe(false);
  });
});

describe("normaliseAppointment", () => {
  const appt = { id: 42, start_time: "2026-10-27T14:30:00Z", finish_time: "2026-10-27T15:00:00Z", practitioner_id: 9, patient_id: 5, reason: "Hygiene visit", state: "Cancelled" };

  it("builds the cancellation", () => {
    const n = normaliseAppointment(appt, {
      doctors: [{ id: "9", name: "Dr Ali Khan" }],
      patient: { first_name: "Tom", last_name: "Lee", email_address: "tom@example.com", mobile_phone: "07700900123" },
    })!;
    expect(n).toMatchObject({
      slotDatetime: new Date("2026-10-27T14:30:00Z"), slotDurationMinutes: 30, procedureType: "cleaning", doctorId: "9", doctorName: "Dr Ali Khan",
      cancelledPatientName: "Tom Lee", cancelledPatientEmail: "tom@example.com", cancelledPatientPhone: "07700900123", cancellationReason: "Hygiene visit", pmsAppointmentId: "42",
    });
    expect(n.rawPayload).toEqual(appt);
  });

  it("falls back to the API practitioner name, and to null when unknown", () => {
    expect(normaliseAppointment(appt, { practitionerName: "Dr API Name" })!.doctorName).toBe("Dr API Name");
    expect(normaliseAppointment(appt)!.doctorName).toBeNull();
  });

  it("uses 30 minutes when the end is missing or silly", () => {
    expect(normaliseAppointment({ ...appt, finish_time: undefined })!.slotDurationMinutes).toBe(30);
    expect(normaliseAppointment({ ...appt, finish_time: "2026-10-27T14:31:00Z" })!.slotDurationMinutes).toBe(30);
    expect(normaliseAppointment({ ...appt, finish_time: "2026-10-27T15:45:00Z" })!.slotDurationMinutes).toBe(75);
  });

  it("returns null without an id or a valid start", () => {
    expect(normaliseAppointment({ ...appt, id: undefined })).toBeNull();
    expect(normaliseAppointment({ ...appt, start_time: "not a date" })).toBeNull();
  });

  it("accepts alternative field names", () => {
    const n = normaliseAppointment({ id: "x", start: "2026-10-27T10:00:00Z", end: "2026-10-27T10:20:00Z", cancellation_reason: "check-up" })!;
    expect(n.slotDurationMinutes).toBe(20);
    expect(n.procedureType).toBe("consultation");
  });
});
