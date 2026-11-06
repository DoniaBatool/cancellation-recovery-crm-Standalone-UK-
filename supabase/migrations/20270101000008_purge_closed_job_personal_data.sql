-- 30-day personal-data purge (DPA clause 8.1). SCRUB, never delete.
-- Added after 0001-0007 (never edit applied migrations).
--
-- Finished job = a cancellation_events row whose slot is older than the retention, OR whose
-- recovery_pipeline row is closed (slot_recovered / expired_manual) for longer than the retention.
--
-- What is scrubbed (set to NULL / '[removed]'):
--   1. cancellation_events: cancelled patient name/email/phone, reason, raw webhook payload.
--   2. recovery_pipeline_history.note (notes can hold patient names).
--   3. messages.body and messages.to_or_from of those jobs (both are NOT NULL, so '[removed]' is the
--      placeholder). channel, direction, status, provider_id and created_at are kept: the health check
--      and the Twilio delivery-status handler read them. Messages not linked to any job are scrubbed
--      once older than the retention too. STOP/START needs nothing from messages: opt-out lives in
--      waitlist.sms_opt_out.
--
-- What is deliberately NOT touched: the active patient list, stage / dates / revenue / procedure_type
-- (monthly reports stay identical), and the pipeline rows themselves (an UPDATE there would fire the
-- set_updated_at trigger). recovery_pipeline.notes (staff-typed close reason) is a known gap for that reason.
-- No rows are ever deleted. Safe to run repeatedly: already-scrubbed rows are skipped.

CREATE TABLE public.purge_log (
  id BIGSERIAL PRIMARY KEY,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retention INTERVAL NOT NULL,
  events_scrubbed INT NOT NULL DEFAULT 0,
  history_notes_cleared INT NOT NULL DEFAULT 0,
  messages_scrubbed INT NOT NULL DEFAULT 0
);

-- RLS on and no policies: only the service role / database owner can read or write it.
ALTER TABLE public.purge_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.purge_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.purge_log_id_seq FROM PUBLIC, anon, authenticated;

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.purge_closed_job_personal_data(retention INTERVAL DEFAULT INTERVAL '30 days')
RETURNS TABLE (events_scrubbed INT, history_notes_cleared INT, messages_scrubbed INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cutoff TIMESTAMPTZ := NOW() - retention;
  v_event_ids UUID[];
  v_pipeline_ids UUID[];
  v_events INT := 0;
  v_notes INT := 0;
  v_messages INT := 0;
  v_count INT;
BEGIN
  SELECT COALESCE(array_agg(e.id), '{}')
    INTO v_event_ids
    FROM public.cancellation_events e
    LEFT JOIN public.recovery_pipeline p ON p.cancellation_event_id = e.id
   WHERE e.slot_datetime < cutoff
      OR (p.stage IN ('slot_recovered', 'expired_manual')
          AND COALESCE(p.confirmed_at, p.expired_at, p.updated_at) < cutoff);

  SELECT COALESCE(array_agg(p.id), '{}')
    INTO v_pipeline_ids
    FROM public.recovery_pipeline p
   WHERE p.cancellation_event_id = ANY (v_event_ids);

  -- 1. The cancelled patient's details and the raw webhook payload.
  UPDATE public.cancellation_events e
     SET cancelled_patient_name = NULL,
         cancelled_patient_email = NULL,
         cancelled_patient_phone = NULL,
         cancellation_reason = NULL,
         raw_payload = NULL
   WHERE e.id = ANY (v_event_ids)
     AND (e.cancelled_patient_name IS NOT NULL OR e.cancelled_patient_email IS NOT NULL
          OR e.cancelled_patient_phone IS NOT NULL OR e.cancellation_reason IS NOT NULL
          OR e.raw_payload IS NOT NULL);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_events := v_count;

  -- 2. Free-text history notes.
  UPDATE public.recovery_pipeline_history h
     SET note = NULL
   WHERE h.pipeline_id = ANY (v_pipeline_ids)
     AND h.note IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_notes := v_count;

  -- 3. Message text and addresses: those of the finished jobs, plus unlinked ones past the retention.
  UPDATE public.messages m
     SET body = '[removed]',
         to_or_from = '[removed]'
   WHERE (m.body <> '[removed]' OR m.to_or_from <> '[removed]')
     AND (m.pipeline_id = ANY (v_pipeline_ids)
          OR m.offer_id IN (SELECT o.id FROM public.waitlist_offers o WHERE o.pipeline_id = ANY (v_pipeline_ids))
          OR (m.pipeline_id IS NULL AND m.offer_id IS NULL AND m.created_at < cutoff));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_messages := v_count;

  INSERT INTO public.purge_log (retention, events_scrubbed, history_notes_cleared, messages_scrubbed)
  VALUES (retention, v_events, v_notes, v_messages);

  RETURN QUERY SELECT v_events, v_notes, v_messages;
END;
$$;

REVOKE ALL ON FUNCTION private.purge_closed_job_personal_data(INTERVAL) FROM PUBLIC, anon, authenticated;
