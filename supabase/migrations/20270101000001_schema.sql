-- Source: SYSTEM_BUILD_GUIDE.md §5.1 (schema). Do not edit without telling Donia.

-- Shared trigger: keep updated_at current
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

-- clinics — tenant root (one row per deployment in practice, but keep multi-tenant safe)
CREATE TABLE public.clinics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,                       -- used in /join/<slug>
  timezone TEXT NOT NULL DEFAULT 'Europe/London',
  country TEXT NOT NULL DEFAULT 'GB',
  pms_type TEXT NOT NULL DEFAULT 'dentally' CHECK (pms_type IN ('dentally','other')),
  pms_clinic_id TEXT,                              -- Dentally site/practice id if needed
  contact_name TEXT,
  contact_email TEXT,                              -- reception inbox: CC'd on bookings, gets alerts
  contact_phone TEXT,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  pilot_started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- clinic_users — Supabase Auth users ↔ clinic, with team role
CREATE TABLE public.clinic_users (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','admin','staff')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, clinic_id)
);
CREATE UNIQUE INDEX uq_clinic_users_one_owner ON public.clinic_users (clinic_id) WHERE role = 'owner';

-- clinic_config — prices, doctors, engine settings (NO secrets here)
CREATE TABLE public.clinic_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL UNIQUE REFERENCES public.clinics(id) ON DELETE CASCADE,
  price_cleaning INT NOT NULL DEFAULT 150,
  price_consultation INT NOT NULL DEFAULT 80,
  price_filling INT NOT NULL DEFAULT 200,
  price_extraction INT NOT NULL DEFAULT 180,
  price_crown INT NOT NULL DEFAULT 700,
  price_implant INT NOT NULL DEFAULT 2500,
  price_whitening INT NOT NULL DEFAULT 350,
  price_default INT NOT NULL DEFAULT 200,
  doctors JSONB NOT NULL DEFAULT '[]',              -- [{ "id": "<pms practitioner id or slug>", "name": "Dr Ali", "email": "ali@clinic.co.uk" }]
  -- engine settings (editable in Settings)
  engine_enabled BOOLEAN NOT NULL DEFAULT FALSE,    -- master switch; FALSE = log cancellations only
  shadow_mode BOOLEAN NOT NULL DEFAULT TRUE,        -- TRUE = SMS/email go to SHADOW_TEST_PHONE/EMAIL, not patients
  offer_channels TEXT[] NOT NULL DEFAULT '{sms,email}', -- subset of {sms,email,whatsapp}
  offer_expiry_minutes INT NOT NULL DEFAULT 15 CHECK (offer_expiry_minutes BETWEEN 5 AND 1440),
  offer_strategy TEXT NOT NULL DEFAULT 'sequential' CHECK (offer_strategy IN ('sequential','batch')),
  batch_size INT NOT NULL DEFAULT 3 CHECK (batch_size BETWEEN 2 AND 10),
  max_offers_per_slot INT NOT NULL DEFAULT 5 CHECK (max_offers_per_slot BETWEEN 1 AND 20),
  min_lead_minutes INT NOT NULL DEFAULT 60,         -- stop offering when slot starts sooner than this
  max_horizon_hours INT NOT NULL DEFAULT 336,       -- ignore cancellations further away than this (2 weeks)
  approval_window_minutes INT NOT NULL DEFAULT 30 CHECK (approval_window_minutes > 0),
  quiet_hours_start TIME NOT NULL DEFAULT '20:00',  -- no SMS between these (clinic local time)
  quiet_hours_end TIME NOT NULL DEFAULT '08:00',
  slack_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  booking_mode TEXT NOT NULL DEFAULT 'manual' CHECK (booking_mode IN ('manual','api')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- waitlist — opt-in patients
CREATE TABLE public.waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,                                       -- E.164
  preferred_procedures TEXT[] NOT NULL DEFAULT '{}',-- empty = any
  preferred_days TEXT[] NOT NULL DEFAULT '{}',      -- 'Monday'..'Sunday'; empty = any
  preferred_times TEXT[] NOT NULL DEFAULT '{}',     -- 'morning'|'afternoon'|'evening'; empty = any
  preferred_doctors TEXT[] NOT NULL DEFAULT '{}',   -- names as in config.doctors; empty = any (soft preference)
  max_notice_hours INT NOT NULL DEFAULT 48 CHECK (max_notice_hours >= 0), -- MINIMUM notice the patient needs (name kept for history)
  notes TEXT,
  opt_in_source TEXT NOT NULL DEFAULT 'receptionist' CHECK (opt_in_source IN ('receptionist','sms_link','online','pms')),
  existing_patient BOOLEAN NOT NULL DEFAULT FALSE,
  pms_patient_id TEXT,                              -- Dentally patient id when known
  sms_opt_out BOOLEAN NOT NULL DEFAULT FALSE,       -- replied STOP
  sms_opt_out_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  added_by TEXT,
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE UNIQUE INDEX uq_waitlist_clinic_pms_patient ON public.waitlist (clinic_id, pms_patient_id) WHERE pms_patient_id IS NOT NULL;
CREATE INDEX idx_waitlist_clinic_active ON public.waitlist (clinic_id, is_active, last_contacted_at);
CREATE INDEX idx_waitlist_phone ON public.waitlist (clinic_id, phone);

-- cancellation_events — every cancellation detected
CREATE TABLE public.cancellation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  slot_datetime TIMESTAMPTZ NOT NULL,
  slot_duration_minutes INT NOT NULL DEFAULT 30 CHECK (slot_duration_minutes > 0),
  procedure_type TEXT,                              -- normalised to our PROCEDURES list when possible
  doctor_id TEXT,                                   -- PMS practitioner id
  doctor_name TEXT,
  cancelled_patient_name TEXT,
  cancelled_patient_email TEXT,
  cancelled_patient_phone TEXT,
  cancellation_reason TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pms_source TEXT NOT NULL DEFAULT 'dentally' CHECK (pms_source IN ('dentally','manual')),
  pms_appointment_id TEXT,                          -- Dentally appointment id → idempotency key
  raw_payload JSONB,                                -- original webhook/API JSON (debugging)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_cancellation_events_pms_appt
  ON public.cancellation_events (clinic_id, pms_source, pms_appointment_id) WHERE pms_appointment_id IS NOT NULL;
CREATE INDEX idx_cancellation_events_clinic_slot ON public.cancellation_events (clinic_id, slot_datetime);

-- recovery_pipeline — one journey per cancellation
CREATE TABLE public.recovery_pipeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  cancellation_event_id UUID NOT NULL UNIQUE REFERENCES public.cancellation_events(id) ON DELETE CASCADE,
  waitlist_patient_id UUID REFERENCES public.waitlist(id) ON DELETE SET NULL, -- current/final patient
  stage TEXT NOT NULL DEFAULT 'cancellation_detected' CHECK (stage IN (
    'cancellation_detected','offer_sent','waiting_staff_approval','slot_recovered','expired_manual')),
  detected_at TIMESTAMPTZ,
  offer_sent_at TIMESTAMPTZ,
  approval_requested_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  procedure_price INT,                              -- price snapshot at detection
  revenue_saved INT,                                -- set when recovered
  approval_token TEXT UNIQUE,                       -- secret for /approve/<token> and Slack button
  approval_token_expires_at TIMESTAMPTZ,
  front_desk_notified_via TEXT CHECK (front_desk_notified_via IN ('crm','email','slack')),
  booked_in_pms_at TIMESTAMPTZ,                     -- reception ticked "Booked ✓" or API booking succeeded
  pms_new_appointment_id TEXT,                      -- when booked via API
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_recovery_pipeline_clinic_stage ON public.recovery_pipeline (clinic_id, stage, created_at);
CREATE INDEX idx_recovery_pipeline_waitlist ON public.recovery_pipeline (waitlist_patient_id);

-- recovery_pipeline_history — every stage transition / note (patient timeline + Activity page)
CREATE TABLE public.recovery_pipeline_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES public.recovery_pipeline(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  note TEXT,
  triggered_by TEXT NOT NULL DEFAULT 'system' CHECK (triggered_by IN ('system','front_desk','engine','manual','patient')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pipeline_history_pipeline ON public.recovery_pipeline_history (pipeline_id, created_at);

-- waitlist_offers — each patient offered each slot
CREATE TABLE public.waitlist_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES public.recovery_pipeline(id) ON DELETE CASCADE,
  waitlist_patient_id UUID NOT NULL REFERENCES public.waitlist(id) ON DELETE CASCADE,
  offered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  response TEXT NOT NULL DEFAULT 'pending' CHECK (response IN ('pending','accepted','declined','expired')),
  responded_at TIMESTAMPTZ,
  responded_via TEXT CHECK (responded_via IN ('link','sms_reply','whatsapp','crm')),
  offer_token TEXT UNIQUE,                          -- UUID v4, the patient's only credential
  offer_expires_at TIMESTAMPTZ
);
CREATE INDEX idx_waitlist_offers_pipeline ON public.waitlist_offers (pipeline_id);
CREATE INDEX idx_waitlist_offers_patient ON public.waitlist_offers (waitlist_patient_id);
CREATE INDEX idx_waitlist_offers_pending ON public.waitlist_offers (response, offer_expires_at) WHERE response = 'pending';

-- messages — every SMS/WhatsApp/email/slack in or out (audit, STOP handling, delivery status)
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  pipeline_id UUID REFERENCES public.recovery_pipeline(id) ON DELETE SET NULL,
  offer_id UUID REFERENCES public.waitlist_offers(id) ON DELETE SET NULL,
  waitlist_patient_id UUID REFERENCES public.waitlist(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms','whatsapp','email','slack')),
  direction TEXT NOT NULL CHECK (direction IN ('out','in')),
  to_or_from TEXT NOT NULL,
  body TEXT NOT NULL,
  provider_id TEXT,                                 -- Twilio MessageSid etc.
  status TEXT,                                      -- queued/sent/delivered/failed/undelivered/received
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_messages_clinic_created ON public.messages (clinic_id, created_at DESC);
CREATE UNIQUE INDEX uq_messages_provider ON public.messages (provider_id) WHERE provider_id IS NOT NULL;

-- engine_state — small key/value per clinic (last poll time, last webhook time, failure counters)
CREATE TABLE public.engine_state (
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (clinic_id, key)
);

CREATE TRIGGER trg_clinics_updated_at BEFORE UPDATE ON public.clinics FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_clinic_config_updated_at BEFORE UPDATE ON public.clinic_config FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_waitlist_updated_at BEFORE UPDATE ON public.waitlist FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_recovery_pipeline_updated_at BEFORE UPDATE ON public.recovery_pipeline FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_clinic_users_clinic ON public.clinic_users (clinic_id);
