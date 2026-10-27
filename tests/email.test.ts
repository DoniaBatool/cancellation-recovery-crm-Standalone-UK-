import { describe, expect, it, vi } from "vitest";
import { createMailer } from "@/lib/email";

const config = { host: "smtp.example.com", port: 587, user: "u", pass: "p", from: "appointments@clinic.co.uk", fromName: "Smile Dentals" };
const mail = { to: "a@example.com", subject: "S", text: "T", html: "<p>T</p>" };

describe("createMailer", () => {
  it("sends with the clinic name as the sender name", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "<m1>" });
    const result = await createMailer(config, { sendMail }).send({ ...mail, fromName: "Other Clinic", cc: "b@example.com" });
    expect(result).toEqual({ ok: true, id: "<m1>" });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: '"Other Clinic" <appointments@clinic.co.uk>', to: "a@example.com", cc: "b@example.com" }));
  });

  it("falls back to the configured name and strips header-breaking characters", async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    await createMailer(config, { sendMail }).send(mail);
    expect(sendMail.mock.calls[0]![0].from).toBe('"Smile Dentals" <appointments@clinic.co.uk>');
    await createMailer(config, { sendMail }).send({ ...mail, fromName: 'Evil"\r\nBcc: x' });
    expect(sendMail.mock.calls[1]![0].from).not.toMatch(/[\r\n]/);
  });

  it("never throws; returns the error text", async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error("535 auth failed"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await createMailer(config, { sendMail }).send(mail);
    expect(result).toEqual({ ok: false, error: "535 auth failed" });
    expect(spy.mock.calls.flat().join(" ")).not.toContain("a@example.com");
    spy.mockRestore();
  });
});
