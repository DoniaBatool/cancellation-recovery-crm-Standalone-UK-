-- 30-day scrub of opted-out waitlist rows (DPA 8.1). SCRUB, never delete.
-- Added after 0001-0008 (never edit applied migrations).
--
-- Scope: ONLY rows with sms_opt_out = TRUE AND is_active = FALSE, 30 days after sms_opt_out_at. STOP sets
-- is_active = FALSE, so a STOP row stays in scope. A row that is active again (the patient signed up again
-- for email, or staff re-activated it) is still wanted by the clinic and is NEVER scrubbed. A patient who
-- replied START (sms_opt_out = FALSE) is never scrubbed. Other inactive patients are out of scope.
--
-- Scrubbed: patient_name -> 'Opted out'; email, notes, pms_patient_id -> NULL; the preference lists ->
-- empty; existing_patient -> FALSE. KEPT on purpose: id, clinic_id, phone, sms_opt_out, sms_opt_out_at.
-- That is the suppression record: the phone number stays ONLY so the patient is never texted again
-- (lib/sms-suppression.ts matches by number). Rows are never deleted.
--
-- scrubbed_at makes the job idempotent: a row is scrubbed once. Rows without a phone are skipped
-- (the table needs an email or a phone, and such a row cannot be matched for suppression anyway).
-- The set_updated_at trigger on waitlist bumps updated_at to now() on the scrub; nothing reads it.

ALTER TABLE public.waitlist
  ADD COLUMN scrubbed_at TIMESTAMPTZ;

-- The purge log from 0008 gets a fourth counter; the existing purge function leaves it at 0.
ALTER TABLE public.purge_log
  ADD COLUMN waitlist_scrubbed INT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION private.scrub_opted_out_waitlist(retention INTERVAL DEFAULT INTERVAL '30 days')
RETURNS TABLE (rows_scrubbed INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cutoff TIMESTAMPTZ := NOW() - retention;
  v_count INT := 0;
BEGIN
  UPDATE public.waitlist w
     SET patient_name = 'Opted out',
         email = NULL,
         notes = NULL,
         pms_patient_id = NULL,
         preferred_procedures = '{}',
         preferred_days = '{}',
         preferred_times = '{}',
         preferred_doctors = '{}',
         existing_patient = FALSE,
         scrubbed_at = NOW()
   WHERE w.sms_opt_out = TRUE
     AND w.sms_opt_out_at IS NOT NULL
     AND w.sms_opt_out_at < cutoff
     AND w.is_active = FALSE
     AND w.phone IS NOT NULL
     AND w.scrubbed_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.purge_log (retention, waitlist_scrubbed)
  VALUES (retention, v_count);

  RETURN QUERY SELECT v_count;
END;
$$;

REVOKE ALL ON FUNCTION private.scrub_opted_out_waitlist(INTERVAL) FROM PUBLIC, anon, authenticated;

-- A scrubbed row has no name or email left, so it must never be switched back on. The CRM checks this first
-- and shows a message; this trigger is the backstop for any other writer (a race, a script, the SQL editor).
-- New sign-ups and staff re-adds create NEW rows instead. START still clears sms_opt_out on a scrubbed row
-- (it does not touch is_active there).
CREATE OR REPLACE FUNCTION private.block_scrubbed_waitlist_reactivation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.scrubbed_at IS NOT NULL AND NEW.is_active = TRUE AND OLD.is_active = FALSE THEN
    RAISE EXCEPTION 'This waitlist row was scrubbed after an opt-out and cannot be switched back on. Add the patient as a new row.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.block_scrubbed_waitlist_reactivation() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_waitlist_block_scrubbed_reactivation
  BEFORE UPDATE OF is_active ON public.waitlist
  FOR EACH ROW EXECUTE FUNCTION private.block_scrubbed_waitlist_reactivation();
