-- Source: SYSTEM_BUILD_GUIDE.md v2.1 (2026-10-26), section 5.1 changes.
-- Follow-up to migrations 0001 and 0002, which are already applied to the live project and must not be edited.
--
-- 1. Offers are held for 30 minutes by default (was 15).
-- 2. Dentally is read-only, so API booking is dropped: no booking_mode and no pms_new_appointment_id.
-- 3. Slack one-tap approval keeps the id of its message so any approval path can update it.

ALTER TABLE public.clinic_config ALTER COLUMN offer_expiry_minutes SET DEFAULT 30;

ALTER TABLE public.clinic_config DROP COLUMN booking_mode;

ALTER TABLE public.recovery_pipeline DROP COLUMN pms_new_appointment_id;

ALTER TABLE public.recovery_pipeline ADD COLUMN slack_message_ts TEXT;
