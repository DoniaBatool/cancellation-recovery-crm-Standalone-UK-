import nodemailer from "nodemailer";
import type { Env } from "@/lib/env";

// Email sending through the clinic's Brevo SMTP (nodemailer). Source: SYSTEM_BUILD_GUIDE.md §3.2, §10.1.
// `send` never throws: a failed email must never undo a stage change.

export type Mail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  cc?: string;
  /** Shown as the sender name, normally the clinic name. */
  fromName?: string;
  replyTo?: string;
};

export type MailResult = { ok: true; id: string | null } | { ok: false; error: string };

export interface Mailer {
  send(mail: Mail): Promise<MailResult>;
}

/** The part of a nodemailer transport that we use. Tests pass a fake. */
export type Transport = {
  sendMail(options: Record<string, unknown>): Promise<{ messageId?: string }>;
};

function formatFrom(name: string | undefined, address: string): string {
  if (!name) return address;
  // Quote the name and strip characters that could break the header.
  const clean = name.replace(/["\r\n<>]/g, "").trim();
  return clean ? `"${clean}" <${address}>` : address;
}

export function createMailer(config: NonNullable<Env["email"]>, transport?: Transport): Mailer {
  const smtp: Transport =
    transport ??
    (nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.pass },
    }) as unknown as Transport);

  return {
    async send(mail) {
      try {
        const info = await smtp.sendMail({
          from: formatFrom(mail.fromName ?? config.fromName ?? undefined, config.from),
          to: mail.to,
          cc: mail.cc,
          replyTo: mail.replyTo,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        });
        return { ok: true, id: info.messageId ?? null };
      } catch (error) {
        // Log the error text only, never the recipient or the body.
        const message = error instanceof Error ? error.message : "Unknown email error";
        console.error("Email send failed:", message);
        return { ok: false, error: message };
      }
    },
  };
}

/** Mailer for this server's environment, or null when SMTP is not configured. */
export function getMailer(email: Env["email"]): Mailer | null {
  return email ? createMailer(email) : null;
}
