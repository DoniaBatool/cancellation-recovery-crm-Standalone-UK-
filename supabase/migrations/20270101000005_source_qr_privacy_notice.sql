-- Source: SYSTEM_BUILD_GUIDE.md §6 (opt-in source, privacy notice on /join).
-- Added after 0001-0004 (never edit applied migrations).
-- 1) Waitlist rows can now say they came from the printed QR code ('qr').
-- 2) Each clinic (the data controller) can store a link to its own privacy notice.

ALTER TABLE public.waitlist DROP CONSTRAINT IF EXISTS waitlist_opt_in_source_check;
ALTER TABLE public.waitlist
  ADD CONSTRAINT waitlist_opt_in_source_check
  CHECK (opt_in_source IN ('receptionist','sms_link','qr','online','pms'));

ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS privacy_notice_url TEXT
  CHECK (privacy_notice_url IS NULL OR privacy_notice_url ~* '^https://');
