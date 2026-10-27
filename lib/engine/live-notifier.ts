import {
  approvalRequestEmail,
  doctorNotificationEmail,
  patientConfirmationEmail,
  slotExpiredAlertEmail,
  slotOfferEmail,
  withTestPrefix,
  type EmailContent,
} from "@/lib/email-templates";
import type { Mail, Mailer } from "@/lib/email";
import type { ConfirmationContext, ExpiredContext, Notifier, OfferChannel, OfferOutContext, ReceptionContext, ResolvedContext } from "@/lib/engine/notifier";
import type { Db } from "@/lib/pipeline";
import type { SmsSender } from "@/lib/sms";
import { bookedSms, offerSms } from "@/lib/sms-templates";
import { closeMessage, postApproval, type SlackConfig } from "@/lib/slack";

// The real notifier: email (Brevo), SMS (Twilio, Phase 4) and Slack. Source: SYSTEM_BUILD_GUIDE.md §7 E4, E6, E8.
// Every method swallows its own errors: a failed send must never undo a stage change.

export type LiveNotifierDeps = {
  db: Db;
  appUrl: string;
  mailer: Mailer | null;
  sms?: SmsSender | null;
  slack?: SlackConfig | null;
  shadow: { email: string | null; phone: string | null };
  fetchImpl?: typeof fetch;
  /** Operator inbox for alerts the clinic cannot receive (unused for now). */
  operatorEmail?: string | null;
};

export function createLiveNotifier(deps: LiveNotifierDeps): Notifier {
  const channels: OfferChannel[] = [];
  if (deps.mailer) channels.push("email");
  if (deps.sms) channels.push("sms");

  async function logMessage(row: {
    clinicId: string;
    pipelineId: string | null;
    offerId?: string | null;
    patientId?: string | null;
    to: string;
    body: string;
    ok: boolean;
    error?: string;
    providerId?: string | null;
  }) {
    try {
      await deps.db.from("messages").insert({
        clinic_id: row.clinicId,
        pipeline_id: row.pipelineId,
        offer_id: row.offerId ?? null,
        waitlist_patient_id: row.patientId ?? null,
        channel: "email",
        direction: "out",
        to_or_from: row.to,
        body: row.body,
        provider_id: row.providerId ?? null,
        status: row.ok ? "sent" : "failed",
        error: row.error ?? null,
      });
    } catch (error) {
      console.error("Could not log email:", error instanceof Error ? error.message : error);
    }
  }

  async function sendMail(
    mail: Omit<Mail, "subject" | "text" | "html"> & EmailContent,
    meta: { clinicId: string; pipelineId: string; offerId?: string; patientId?: string },
  ): Promise<boolean> {
    if (!deps.mailer) return false;
    const result = await deps.mailer.send(mail);
    await logMessage({
      ...meta,
      to: mail.to,
      body: mail.text,
      ok: result.ok,
      error: result.ok ? undefined : result.error,
    });
    return result.ok;
  }

  return {
    channels,

    async offerOut(ctx: OfferOutContext): Promise<OfferChannel[]> {
      const sent: OfferChannel[] = [];
      const link = `${deps.appUrl}/confirm/${ctx.offerToken}`;
      const meta = { clinicId: ctx.clinic.id, pipelineId: ctx.pipelineId, offerId: ctx.offerId, patientId: ctx.patient.id };

      if (ctx.channels.includes("email") && ctx.patient.email && deps.mailer) {
        const to = ctx.shadowMode ? deps.shadow.email : ctx.patient.email;
        if (to) {
          let content = slotOfferEmail({
            clinicName: ctx.clinic.name,
            timeZone: ctx.clinic.timezone,
            patientName: ctx.patient.name,
            procedure: ctx.slot.procedure,
            dentist: ctx.slot.doctorName,
            slotDatetime: ctx.slot.datetime,
            expiresAt: ctx.offerExpiresAt,
            expiryMinutes: ctx.offerExpiryMinutes,
            link,
            differentDentist: ctx.preferredDoctorMatch === "no",
          });
          if (ctx.shadowMode) content = withTestPrefix(content, ctx.patient.name);
          if (await sendMail({ to, fromName: ctx.clinic.name, replyTo: ctx.clinic.contactEmail ?? undefined, ...content }, meta)) {
            sent.push("email");
          }
        }
      }

      if (ctx.channels.includes("sms") && ctx.patient.phone && deps.sms) {
        const to = ctx.shadowMode ? deps.shadow.phone : ctx.patient.phone;
        if (to) {
          const text = offerSms({
            clinicName: ctx.clinic.name,
            timeZone: ctx.clinic.timezone,
            procedure: ctx.slot.procedure,
            dentist: ctx.slot.doctorName,
            slotDatetime: ctx.slot.datetime,
            link: `${deps.appUrl}/c/${ctx.offerToken}`,
            expiryMinutes: ctx.offerExpiryMinutes,
            differentDentist: ctx.preferredDoctorMatch === "no",
          });
          const ok = await deps.sms.send({
            to,
            body: ctx.shadowMode ? `[TEST for ${ctx.patient.name}] ${text}` : text,
            clinicId: ctx.clinic.id,
            pipelineId: ctx.pipelineId,
            offerId: ctx.offerId,
            patientId: ctx.patient.id,
          });
          if (ok) sent.push("sms");
        }
      }
      return sent;
    },

    async receptionApproval(ctx: ReceptionContext) {
      const approveLink = `${deps.appUrl}/approve/${ctx.approvalToken}`;
      let via: "slack" | "email" | null = null;
      let slackMessageTs: string | null = null;

      if (ctx.slackEnabled && deps.slack && !ctx.reminder) {
        slackMessageTs = await postApproval(
          deps.slack,
          {
            timeZone: ctx.clinic.timezone,
            patientName: ctx.patient.name,
            patientPhone: ctx.patient.phone,
            procedure: ctx.slot.procedure,
            dentist: ctx.slot.doctorName,
            slotDatetime: ctx.slot.datetime,
            price: ctx.price,
            pipelineId: ctx.pipelineId,
            approvalToken: ctx.approvalToken,
          },
          deps.fetchImpl,
        );
        if (slackMessageTs) via = "slack";
      }

      if (ctx.clinic.contactEmail && deps.mailer) {
        const content = approvalRequestEmail({
          timeZone: ctx.clinic.timezone,
          patientName: ctx.patient.name,
          patientPhone: ctx.patient.phone,
          procedure: ctx.slot.procedure,
          dentist: ctx.slot.doctorName,
          slotDatetime: ctx.slot.datetime,
          price: ctx.price,
          approvalWindowMinutes: ctx.approvalWindowMinutes,
          link: approveLink,
        });
        const mail = ctx.reminder ? { ...content, subject: `Reminder: ${content.subject}` } : content;
        const ok = await sendMail({ to: ctx.clinic.contactEmail, fromName: ctx.clinic.name, ...mail }, { clinicId: ctx.clinic.id, pipelineId: ctx.pipelineId });
        if (ok && !via) via = "email";
      }
      return { via, slackMessageTs };
    },

    async confirmation(ctx: ConfirmationContext): Promise<string> {
      // Patient text: only when SMS is set up and the patient has not opted out.
      let smsNote = "";
      if (deps.sms && ctx.patient.phone && !ctx.patient.smsOptOut) {
        const to = ctx.shadowMode ? deps.shadow.phone : ctx.patient.phone;
        if (to) {
          const body = bookedSms({ clinicName: ctx.clinic.name, clinicPhone: ctx.clinic.phone, slotDatetime: ctx.slot.datetime, timeZone: ctx.clinic.timezone });
          const ok = await deps.sms.send({
            to,
            body: ctx.shadowMode ? `[TEST for ${ctx.patient.name}] ${body}` : body,
            clinicId: ctx.clinic.id,
            pipelineId: ctx.pipelineId,
            patientId: ctx.patient.id,
          });
          smsNote = `, sms: ${ok ? "sent" : "failed"}`;
        }
      }
      if (!deps.mailer) return `Confirmation emails not sent (email is not set up)${smsNote}.`;
      const meta = { clinicId: ctx.clinic.id, pipelineId: ctx.pipelineId, patientId: ctx.patient.id };
      const shadowTo = deps.shadow.email;
      const redirect = (to: string | null): string | null => (ctx.shadowMode ? shadowTo : to);
      const mark = (c: EmailContent): EmailContent => (ctx.shadowMode ? withTestPrefix(c, ctx.patient.name) : c);
      const state = (ok: boolean | null) => (ok === null ? "not sent (no address)" : ok ? "sent" : "failed");

      let patientOk: boolean | null = null;
      const patientTo = redirect(ctx.patient.email);
      if (patientTo) {
        patientOk = await sendMail(
          {
            to: patientTo,
            fromName: ctx.clinic.name,
            replyTo: ctx.clinic.contactEmail ?? undefined,
            ...mark(
              patientConfirmationEmail({
                clinicName: ctx.clinic.name,
                clinicAddress: ctx.clinic.address,
                clinicPhone: ctx.clinic.phone,
                timeZone: ctx.clinic.timezone,
                patientName: ctx.patient.name,
                procedure: ctx.slot.procedure,
                dentist: ctx.slot.doctorName,
                slotDatetime: ctx.slot.datetime,
              }),
            ),
          },
          meta,
        );
      }

      // The doctor gets the email, reception is copied. With no doctor email, reception gets it alone.
      const reception = redirect(ctx.clinic.contactEmail);
      const doctorTo = redirect(ctx.doctorEmail);
      let doctorOk: boolean | null = null;
      let receptionOk: boolean | null = null;
      const doctorContent = mark(
        doctorNotificationEmail({
          timeZone: ctx.clinic.timezone,
          patientName: ctx.patient.name,
          patientPhone: ctx.patient.phone,
          patientEmail: ctx.patient.email,
          procedure: ctx.slot.procedure,
          slotDatetime: ctx.slot.datetime,
          cancelledPatientName: ctx.cancelledPatientName ?? null,
        }),
      );
      if (doctorTo) {
        doctorOk = await sendMail({ to: doctorTo, cc: reception && reception !== doctorTo ? reception : undefined, fromName: ctx.clinic.name, ...doctorContent }, meta);
        if (reception) receptionOk = doctorOk;
      } else if (reception) {
        receptionOk = await sendMail({ to: reception, fromName: ctx.clinic.name, ...doctorContent }, meta);
      }
      const shadowNote = ctx.shadowMode ? " (shadow mode: sent to the test inbox)" : "";
      return `Confirmation email — patient: ${state(patientOk)}, doctor: ${state(doctorOk)}, reception: ${state(receptionOk)}${smsNote}${shadowNote}.`;
    },

    async slotExpired(ctx: ExpiredContext): Promise<void> {
      if (!deps.mailer || !ctx.clinic.contactEmail) return;
      const content = slotExpiredAlertEmail({
        timeZone: ctx.clinic.timezone,
        procedure: ctx.slot.procedure,
        dentist: ctx.slot.doctorName,
        slotDatetime: ctx.slot.datetime,
        offeredCount: ctx.offeredCount,
        reason: ctx.reason,
        link: `${deps.appUrl}/crm`,
      });
      await sendMail({ to: ctx.clinic.contactEmail, fromName: ctx.clinic.name, ...content }, { clinicId: ctx.clinic.id, pipelineId: ctx.pipelineId });
    },

    async approvalResolved(ctx: ResolvedContext): Promise<void> {
      if (!deps.slack || !ctx.slackMessageTs) return;
      await closeMessage(deps.slack, ctx.slackMessageTs, "", ctx.text, deps.fetchImpl);
    },
  };
}
