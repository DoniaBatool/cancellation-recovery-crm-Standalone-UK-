-- Approval audit trail (DPA clause 5.6).
-- Every approval records WHO approved, WHEN, through WHICH channel, and every offer records which
-- VERSION of the offer text was sent. Added after 0001-0006 (never edit applied migrations).
--
-- approved_by      (existing) UUID of the CRM login; stays NULL for Slack approvals.
-- approved_by_name (new)      display name: CRM user's name/email, or the Slack user's name.
-- approved_via     (new)      portal = CRM board, slack = Slack one-tap button, email = /approve/<token> link,
--                             other = reserved for future paths (e.g. the optional external API).

ALTER TABLE public.recovery_pipeline
  ADD COLUMN approved_by_name TEXT,
  ADD COLUMN approved_via TEXT CHECK (approved_via IN ('portal','slack','email','other'));

-- Label of the offer text that was sent, e.g. "offer-email-v1,offer-sms-v1". Constants live in
-- lib/template-versions.ts; bump the label there whenever the wording changes.
ALTER TABLE public.waitlist_offers
  ADD COLUMN template_version TEXT;
