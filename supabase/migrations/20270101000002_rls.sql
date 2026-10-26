-- Source: SYSTEM_BUILD_GUIDE.md §5.2 (Row Level Security). Do not edit without telling Donia.
-- Logged-in staff only see their own clinic. Webhooks, crons and patient pages use the admin (secret-key) client.

CREATE SCHEMA IF NOT EXISTS private;
CREATE OR REPLACE FUNCTION private.user_clinic_ids()
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT clinic_id FROM public.clinic_users WHERE user_id = (SELECT auth.uid());
$$;
REVOKE ALL ON FUNCTION private.user_clinic_ids() FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.user_clinic_ids() TO authenticated;

ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancellation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_pipeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_pipeline_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engine_state ENABLE ROW LEVEL SECURITY;   -- no policies = service role only

CREATE POLICY clinics_select ON public.clinics FOR SELECT TO authenticated
  USING (id IN (SELECT private.user_clinic_ids()));
CREATE POLICY clinic_users_select ON public.clinic_users FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY clinic_config_select ON public.clinic_config FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT private.user_clinic_ids()));
CREATE POLICY clinic_config_update ON public.clinic_config FOR UPDATE TO authenticated
  USING (clinic_id IN (SELECT private.user_clinic_ids())) WITH CHECK (clinic_id IN (SELECT private.user_clinic_ids()));
CREATE POLICY waitlist_select ON public.waitlist FOR SELECT TO authenticated USING (clinic_id IN (SELECT private.user_clinic_ids()));
CREATE POLICY waitlist_insert ON public.waitlist FOR INSERT TO authenticated WITH CHECK (clinic_id IN (SELECT private.user_clinic_ids()));
CREATE POLICY waitlist_update ON public.waitlist FOR UPDATE TO authenticated
  USING (clinic_id IN (SELECT private.user_clinic_ids())) WITH CHECK (clinic_id IN (SELECT private.user_clinic_ids()));
CREATE POLICY waitlist_delete ON public.waitlist FOR DELETE TO authenticated USING (clinic_id IN (SELECT private.user_clinic_ids()));
CREATE POLICY cancellation_events_select ON public.cancellation_events FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT private.user_clinic_ids()));
CREATE POLICY recovery_pipeline_select ON public.recovery_pipeline FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT private.user_clinic_ids()));
CREATE POLICY pipeline_history_select ON public.recovery_pipeline_history FOR SELECT TO authenticated
  USING (pipeline_id IN (SELECT id FROM public.recovery_pipeline WHERE clinic_id IN (SELECT private.user_clinic_ids())));
CREATE POLICY waitlist_offers_select ON public.waitlist_offers FOR SELECT TO authenticated
  USING (pipeline_id IN (SELECT id FROM public.recovery_pipeline WHERE clinic_id IN (SELECT private.user_clinic_ids())));
CREATE POLICY messages_select ON public.messages FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT private.user_clinic_ids()));
