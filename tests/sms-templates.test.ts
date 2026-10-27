import { describe, expect, it } from "vitest";
import { bookedSms, isGsm7, noReceivedSms, offerSms, stopSms, toGsm7, tooLateSms, unknownReplySms, yesReceivedSms } from "@/lib/sms-templates";
import { normaliseReply, parseSmsReply } from "@/lib/sms-reply";

const base = {
  clinicName: "Smile Dentals",
  timeZone: "Europe/London",
  procedure: "Filling",
  dentist: "Dr Ali",
  slotDatetime: "2026-10-27T14:30:00Z",
  link: "https://app.example.com/c/abc12345-1234-4123-8123-123456789abc",
  expiryMinutes: 30,
  differentDentist: false,
};

describe("offerSms", () => {
  it("follows the guide wording", () => {
    const text = offerSms({ ...base, link: "https://x.co/c/t" });
    expect(text).toBe("Smile Dentals: a filling slot Tue 27 Oct 14:30 with Dr Ali is free. Want it? https://x.co/c/t or reply YES/NO. Held 30 min. STOP to opt out");
  });

  it("is GSM-7 and fits one segment with a short link", () => {
    const text = offerSms({ ...base, link: "https://app.example.com/c/abc" });
    expect(isGsm7(text)).toBe(true);
    expect(text.length).toBeLessThanOrEqual(160);
  });

  it("shortens a long clinic name to fit, never below 8 characters", () => {
    const text = offerSms({ ...base, clinicName: "The Very Long Named Dental Practice And Implant Centre", link: "https://x.co/c/abc123" });
    expect(text.length).toBeLessThanOrEqual(160);
    expect(text.startsWith("The Very")).toBe(true);
  });

  it("flags the other dentist", () => {
    expect(offerSms({ ...base, differentDentist: true })).toContain("(not your usual dentist)");
  });

  it("turns curly quotes and dashes into GSM-7", () => {
    const text = offerSms({ ...base, clinicName: "Dr O’Neil – Dental", link: "https://x.co/c/t" });
    expect(isGsm7(text)).toBe(true);
    expect(text).toContain("Dr O'Neil - Dental");
  });

  it("copes with no procedure or dentist", () => {
    expect(offerSms({ ...base, procedure: null, dentist: null })).toContain("a dental slot Tue 27 Oct 14:30 is free");
  });
});

describe("isGsm7 / toGsm7", () => {
  it("accepts £ and rejects emoji and curly quotes", () => {
    expect(isGsm7("£50 ok")).toBe(true);
    expect(isGsm7("hi 👍")).toBe(false);
    expect(isGsm7("it’s")).toBe(false);
    expect(toGsm7("it’s")).toBe("it's");
  });
});

describe("fixed replies", () => {
  it("match the guide", () => {
    expect(yesReceivedSms("Smile Dentals")).toBe("Thanks! Smile Dentals will confirm your booking shortly.");
    expect(noReceivedSms()).toBe("No problem, we'll keep you on the list.");
    expect(tooLateSms()).toBe("Sorry, that slot has now gone. We'll text you next time.");
    expect(unknownReplySms()).toBe("Thanks, the practice will get back to you.");
    expect(stopSms("Smile Dentals")).toBe("You won't get more texts from Smile Dentals. Reply START to rejoin.");
    expect(bookedSms({ clinicName: "Smile Dentals", clinicPhone: "020 0000 0000", slotDatetime: "2026-10-27T14:30:00Z", timeZone: "Europe/London" })).toBe(
      "Confirmed: Tue 27 Oct 14:30 at Smile Dentals. Can't make it? Call 020 0000 0000.",
    );
  });
});

describe("parseSmsReply", () => {
  it.each([
    ["YES", "yes"], ["yes", "yes"], [" Yes! ", "yes"], ["y", "yes"], ["Yeah", "yes"], ["ok", "yes"], ["👍", "yes"],
    ["NO", "no"], ["no.", "no"], ["N", "no"], ["nope", "no"],
    ["STOP", "stop"], ["stop!", "stop"], ["Unsubscribe", "stop"], ["QUIT", "stop"], ["cancel", "stop"],
    ["START", "start"],
    ["maybe later", "other"], ["", "other"], ["yes please call me", "other"],
  ])("%j -> %s", (body, expected) => {
    expect(parseSmsReply(body)).toBe(expected);
  });

  it("normalises punctuation and spacing", () => {
    expect(normaliseReply("  y e s ")).toBe("Y E S");
    expect(normaliseReply("Yes!!!")).toBe("YES");
  });
});
