-- Monthly reports: one saved snapshot per clinic per calendar month, so past months can be viewed
-- (and downloaded as PDF) at any time. The numbers are derived from recovery_pipeline +
-- cancellation_events; the snapshot freezes them once the month is over.
-- Added after 0001-0005 (never edit applied migrations).

CREATE TABLE public.monthly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  month DATE NOT NULL CHECK (month = date_trunc('month', month)::date),
  data JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, month)
);

CREATE TRIGGER trg_monthly_reports_updated_at BEFORE UPDATE ON public.monthly_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.monthly_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY monthly_reports_select ON public.monthly_reports FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT private.user_clinic_ids()));
CREATE POLICY monthly_reports_insert ON public.monthly_reports FOR INSERT TO authenticated
  WITH CHECK (clinic_id IN (SELECT private.user_clinic_ids()));
CREATE POLICY monthly_reports_update ON public.monthly_reports FOR UPDATE TO authenticated
  USING (clinic_id IN (SELECT private.user_clinic_ids()))
  WITH CHECK (clinic_id IN (SELECT private.user_clinic_ids()));
