# SYSTEM_BUILD_GUIDE.md — build the complete Cancellation Recovery system from zero

_Version 2.1 · 2026-10-26 · Owner: Donia · Private (keep out of any public repo)._

> **Changes in 2.1 (decisions by Donia, 2026-10-26):**
> - Offer hold time default is **30 minutes** (was 15). SMS stays as a main channel; default channels are still `{sms,email}`.
> - **Dentally is read-only.** Each clinic creates a read-only API token and gives it to us. We only read (cancellations, appointments, practitioners) and never write to Dentally. API booking is dropped: booking is always manual ("Book in Dentally" checklist). `booking_mode` and `pms_new_appointment_id` are removed and E7 v2 no longer exists.
> - **Slack one-tap approval is in scope** (Phase 3), not "Later". The CRM button and the email link stay as backup.
> - The system follows the structure of the earlier CRM project (same stack, folders, pages and design), plus our own engine, Slack approval and read-only Dentally (§3.5).

This one file is the **complete, self-contained specification** of the system: the CRM and the engine. The engine is the part that detects cancellations, sends SMS/WhatsApp, reads replies, gets front-desk approval and books. You should be able to start a **brand-new empty project** with only this file and build everything. Nothing here depends on any other document, repo or person.

> **How to use this file with Claude in a new project:** put it in the project root as `SYSTEM_BUILD_GUIDE.md`, then say:
> "Read SYSTEM_BUILD_GUIDE.md fully. We build it phase by phase (§19). Start Phase 1. Follow the conventions in §3.3."
>
> After each phase, tick the checklist at the end.

> **Rules for building it yourself:**
> - Write the engine yourself from this spec. Don't copy anyone else's automation workflows, prompts or credentials.
> - If you have a business partner, put ownership and who-can-sell-what in writing before selling solo.
> - Not legal advice. A short call with a UK solicitor before the first solo sale is worth it.

---

## Table of contents

0. Glossary
1. The product in one page
2. End-to-end flow (the "story" of one cancelled slot)
3. Architecture, stack and conventions
4. Accounts you need
5. Database — full SQL (final schema + RLS)
6. Core domain logic (pure functions, with exact rules)
7. The engine — modules E1–E10
8. HTTP routes (webhooks, crons, actions, optional external API)
9. Pages and UI — every screen
10. Emails and SMS/WhatsApp copy
11. Design language
12. Environment variables
13. One isolated system per clinic — setup script
14. Testing
15. Security checklist
16. UK compliance (GDPR / PECR)
17. Pricing and selling
18. Other sectors, CQC leads, USA
19. Build plan (phases with "done when")
20. Prompts for Claude
21. Other products to sell later
22. Progress checklist

---

## 0. Glossary

| Term | Meaning |
| --- | --- |
| **Clinic** | One customer (a dental practice). Each clinic gets its **own** deployment, database and email account (§13). |
| **PMS** | Practice Management System: the clinic's diary and patient records. v1 target: **Dentally**. |
| **Cancellation / slot** | An appointment that was cancelled. Its time is now an empty slot to refill. |
| **Waitlist** | Patients who agreed to be contacted if an earlier slot opens. |
| **Pipeline** | One recovery journey per cancelled slot. It moves through **stages** (§6.1). |
| **Offer** | One invitation to one waitlist patient for one slot. It has a secret **offer token** and an expiry. |
| **Approval** | Front desk confirms they're happy to book the patient who said YES. |
| **Recovered** | The slot was refilled. `revenue_saved` = that procedure's price. |
| **Owner / Admin / Staff** | Team roles inside one clinic's CRM (§6.8). |

---

## 1. The product in one page

**Problem:** when a patient cancels late, the dentist's chair sits empty and the practice loses that income. Reception rarely has time to phone people to fill it.

**Solution:** the moment a cancellation appears in the PMS, the system:

1. finds the best waitlist patient;
2. offers the slot by SMS (and email, optionally WhatsApp);
3. lets the patient answer YES/NO with one tap;
4. asks reception to approve with one tap;
5. tells reception exactly what to book in Dentally (the system never writes to Dentally);
6. moves to the next patient if someone says NO or doesn't answer;
7. shows the clinic a dashboard: slots recovered, revenue saved, recovery rate, average fill time.

**Users:**

- **Practice manager / reception:** uses the CRM.
- **Patients:** never log in. They only see the sign-up page and the offer page.
- **You (operator):** sets up each clinic.

**Market positioning:** UK private dental practices first. One isolated system per clinic is a selling point, because data never mixes between clinics.

---

## 2. End-to-end flow

```
Dentally (clinic PMS)
  │ appointment cancelled  ── webhook (instant) + poller every 5 min (backup)
  ▼
E2 intake ─► cancellation_events + recovery_pipeline (stage: cancellation_detected)
  ▼
E3 match waitlist (procedure, notice, days/times, preferred dentist)
  ▼
E4 offer to best patient ─► waitlist_offers row (token, expiry)
     ├─ SMS (Twilio) with link /confirm/<token>  + "or reply YES / NO"
     ├─ Email (Brevo) with "Answer now" button → same link
     └─ WhatsApp (optional, approved template)
  stage: offer_sent
  ▼
Patient answers ONCE, on any channel (same token everywhere — first answer wins)
  ├─ YES ─► stage: waiting_staff_approval
  │          ▼
  │        E6 reception notified (Slack message with one-tap Approve; CRM card turns amber + email with Approve link as backup)
  │          ▼ reception taps Approve
  │        E7 book: manual only — "Book in Dentally" checklist + "Booked ✓" (the Dentally token is read-only)
  │          ▼
  │        stage: slot_recovered  + confirmation emails (patient, doctor, CC reception)
  │
  ├─ NO ─► offer closed as declined ─► E8 offer the NEXT patient immediately
  └─ no answer before expiry ─► E8 cron marks it expired ─► offer the next patient
         └─ nobody left / slot too close ─► stage: expired_manual + "slot still unfilled" email
```

### Answering on more than one channel

There is **one offer token per patient per slot**, used in the SMS link, the email button and the SMS reply mapping.

- The patient answers once, anywhere. That first answer is recorded atomically (`UPDATE ... WHERE response = 'pending'`).
- Any later tap on another channel shows "Thank you — we've got your reply", "This slot has been filled" or "This offer has expired".
- Reception sees exactly one card. No double booking is possible, because stage changes use an optimistic lock (§6.1).

### Why SMS matters

An email offer alone is slow, because many patients check email hours later. Slots must be filled within an hour or two, so SMS is the main offer channel and email is the backup. The default hold time is **30 minutes** (`offer_expiry_minutes`, editable per clinic).

SMS has **no buttons**. It carries the link, where the YES/NO buttons are, and also accepts a typed "YES"/"NO" reply. WhatsApp templates *can* have quick-reply buttons.

---

## 3. Architecture, stack and conventions

### 3.1 Decision: everything in one Next.js app (no n8n)

| Option | Why / why not |
| --- | --- |
| **One Next.js app (chosen)** | One codebase, one deploy, one place for secrets, unit-testable, cheaper to run per clinic. |
| Separate automation tool (n8n/Make) | Visual, but a second system per clinic to host, secure and monitor; harder to test. |

The engine is implemented as:

- plain TypeScript functions in `lib/engine/*`;
- called from webhooks (`app/api/webhooks/*`), cron routes (`app/api/cron/*`) and server actions.

### 3.2 Stack (pin these or newer)

| Layer | Choice |
| --- | --- |
| Framework | **Next.js 16** App Router, React 19, TypeScript strict, Server Components and Server Actions |
| DB / Auth | **Supabase** (Postgres + Auth), region **London (eu-west-2)**. `@supabase/ssr` for cookie sessions, `@supabase/supabase-js` |
| Validation | **Zod 4** for every input: API bodies, forms, env |
| Email | **Brevo** SMTP via `nodemailer` (each clinic sends from its own domain) |
| SMS / WhatsApp | **Twilio** (`twilio` npm package) |
| Front-desk approval | Slack app (Block Kit buttons: one-tap Approve) |
| UI | Tailwind CSS 4, shadcn-style components on `radix-ui`, `lucide-react` icons, `recharts` for charts |
| QR | `qrcode` |
| Tests | **Vitest** |
| Hosting | **Vercel** (one project per clinic). Crons via Supabase `pg_cron` + `pg_net` or Vercel Cron (§7 E9) |
| Package manager | pnpm |

### 3.3 Conventions (tell Claude to follow these)

1. **Every stage change goes through one function**, `transitionStage()` (§6.1). It also writes a history row. Never update `recovery_pipeline.stage` anywhere else.
2. **Zod at every edge.** Use `parseJsonBody(request, schema)` for routes, `formDataToObject()` + `safeParse` for forms, and `fieldErrors()` for inline errors.
3. **Two Supabase clients:**
   - `createSupabaseServerClient()`: cookie session, RLS applies. Use it for CRM pages.
   - `getAdminClient()`: secret key, bypasses RLS. Use it **only** for patient pages, webhooks, crons and team invites. It never reaches the browser.
4. **API responses:** `{ ok: true, ...data }` or `{ ok: false, error: { code, message, details? } }`. Throw `new ApiError(status, code, message)` and let a wrapper turn it into JSON.
5. **Idempotent everywhere:**
   - webhooks may arrive twice;
   - unique indexes plus "return the existing row" make repeats harmless.
6. **Never lose a booking because of email/SMS.**
   - Send functions **never throw**; they return `false` and log.
   - Always `await` them; on Vercel, no fire-and-forget.
7. **Pure logic in `lib/`, with tests:** matching, pricing, metrics, offer state, permissions, sync plans and phone normalisation.
8. **Times:** store `timestamptz` (UTC). Display in the clinic timezone (`Europe/London`) with `Intl.DateTimeFormat('en-GB', { timeZone })`.
9. **Money:** whole pounds as `INT` (GBP).
10. **Secrets only in env vars,** never in the database or the repo. `.env.local` and `clinics/*.env` are gitignored.
11. **Phones:** store as E.164 (`+447700900001`) using `normalizeUkPhone()` (§6.6).

### 3.4 Folder structure

```
app/
  (app)/layout.tsx                 # logged-in shell: sidebar nav + mobile nav
  (app)/dashboard/page.tsx
  (app)/crm/page.tsx               # pipeline board (Kanban)
  (app)/crm/waitlist/page.tsx + actions.ts
  (app)/crm/patient/[id]/page.tsx
  (app)/crm/activity/page.tsx
  (app)/crm/config/page.tsx + actions.ts + qr/route.ts
  (app)/crm/team/page.tsx + actions.ts
  (app)/crm/approve/actions.ts     # Approve / Decline / Booked ✓ server actions
  (print)/crm/config/qr-card/page.tsx
  login/  forgot-password/  set-password/  auth/confirm/  no-access/
  join/[slug]/page.tsx + join-form.tsx + actions.ts      # public patient sign-up
  confirm/[token]/page.tsx + offer-actions.tsx + actions.ts  # public offer page
  approve/[token]/page.tsx         # reception one-click link from email → opens card
  api/webhooks/dentally/[secret]/route.ts
  api/webhooks/twilio/inbound/route.ts
  api/webhooks/twilio/status/route.ts
  api/webhooks/slack/actions/route.ts
  api/cron/dentally-poll/route.ts
  api/cron/offers-tick/route.ts
  api/cron/health-check/route.ts
  api/health/route.ts
  api/v1/*                          # optional external API (§8.4)
lib/
  constants.ts  validation.ts  env.ts  format.ts  pricing.ts  metrics.ts
  pipeline.ts  offers.ts  waitlist-matching.ts  waitlist-sync.ts  waitlist-optin.ts  waitlist-qr.ts
  team.ts  team-permissions.ts  session.ts  queries.ts  crm-data.ts
  email.ts  email-templates.ts  sms.ts  sms-templates.ts  slack.ts
  dentally/client.ts  dentally/normalise.ts
  engine/intake.ts  engine/offer.ts  engine/advance.ts  engine/approve.ts  engine/inbound.ts
  api/http.ts  api/auth.ts
  supabase/server.ts  supabase/client.ts  supabase/admin.ts
  database.types.ts                 # generated
components/ui/*  components/crm/*  components/dashboard/*  components/shell/*
proxy.ts                            # Next 16 "proxy" (middleware): session refresh + route guard
supabase/migrations/*.sql
scripts/clinic-setup.mjs  scripts/clinic-admin.mjs  scripts/simulate-flow.mjs
tests/*.test.ts
```

### 3.5 Reference project (same structure and look)

This system is built the way Donia's earlier CRM project (`Cancellation_Recovery_CRM`) is built: same stack (§3.2), same folders (§3.4), same pages (dashboard, pipeline board, waitlist, patient, activity, settings, team, `/join`, `/confirm`, print QR card), same design language (§11), the per-clinic setup script (§13) and the same test style.

What is different here:

- the engine (E1–E10) lives in this app; there are no n8n workflows and no partner API layer;
- reception approves with **one tap in Slack** (plus the CRM and email backup) and has an extra `/approve/[token]` page;
- Dentally is connected **read-only** with a token that each clinic gives us.

Use the earlier project as a reference for UI and CRM code. Don't copy its partner/n8n logic or any credentials, and don't change that project. Check ownership of shared code with your partner before reusing it (see the rules at the top).

---

## 4. Accounts you need

| Account | Who | Purpose | Notes |
| --- | --- | --- | --- |
| Supabase | one project **per clinic** | DB + Auth | London region. A personal access token (`sbp_...`) lets the setup script configure it. |
| Vercel | one project **per clinic** | Hosting | Custom domain optional (e.g. `recovery.clinicname.co.uk`). |
| Brevo | one account **per clinic** | Email from the clinic's own domain | Verify the domain (SPF/DKIM) so patient emails don't land in spam. Also used as Supabase Auth SMTP. |
| Twilio | yours (sub-account per clinic recommended) | SMS (+ WhatsApp later) | UK two-way SMS needs a number that can **receive** SMS. An alphanumeric sender ID (e.g. "SmileDent") is one-way only, so replies won't arrive. Check current Twilio UK number availability, regulatory bundle requirements and prices before quoting. |
| WhatsApp Business (via Twilio) | per clinic, later | WhatsApp offers | Needs Meta business verification and **pre-approved templates** for business-initiated messages. |
| Dentally | clinic's admin | **Read-only** API token + webhook | The clinic's Dentally admin creates a read-only API token (Settings → Developer) and sends it to you, and adds the webhook. We only read; we never write to the clinic's diary. For development, ask Dentally's partnership/developer team for **sandbox** access and read their API docs for exact endpoints and state names. |
| Slack app | per clinic | One-tap **Approve** / **Offer to next** buttons for the front desk | Primary approval channel. The clinic installs the app in its own Slack workspace and picks a front-desk-only channel. A clinic without Slack uses the CRM / email approve link instead. |

---

## 5. Database — full SQL

Put this in `supabase/migrations/20270101000001_schema.sql` (first migration) and `..._rls.sql` (second). Then run `supabase gen types typescript` → `lib/database.types.ts`.

### 5.1 Schema

```sql
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
  offer_expiry_minutes INT NOT NULL DEFAULT 30 CHECK (offer_expiry_minutes BETWEEN 5 AND 1440),
  offer_strategy TEXT NOT NULL DEFAULT 'sequential' CHECK (offer_strategy IN ('sequential','batch')),
  batch_size INT NOT NULL DEFAULT 3 CHECK (batch_size BETWEEN 2 AND 10),
  max_offers_per_slot INT NOT NULL DEFAULT 5 CHECK (max_offers_per_slot BETWEEN 1 AND 20),
  min_lead_minutes INT NOT NULL DEFAULT 60,         -- stop offering when slot starts sooner than this
  max_horizon_hours INT NOT NULL DEFAULT 336,       -- ignore cancellations further away than this (2 weeks)
  approval_window_minutes INT NOT NULL DEFAULT 30 CHECK (approval_window_minutes > 0),
  quiet_hours_start TIME NOT NULL DEFAULT '20:00',  -- no SMS between these (clinic local time)
  quiet_hours_end TIME NOT NULL DEFAULT '08:00',
  slack_enabled BOOLEAN NOT NULL DEFAULT FALSE,     -- TRUE once the clinic's Slack app is connected (setup script sets it)
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
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- NULL when approved from Slack (the Slack user is named in the history note)
  confirmed_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  procedure_price INT,                              -- price snapshot at detection
  revenue_saved INT,                                -- set when recovered
  approval_token TEXT UNIQUE,                       -- secret for /approve/<token> and Slack button
  approval_token_expires_at TIMESTAMPTZ,
  front_desk_notified_via TEXT CHECK (front_desk_notified_via IN ('crm','email','slack')),
  slack_message_ts TEXT,                            -- the Slack approval message, updated after any approval path
  booked_in_pms_at TIMESTAMPTZ,                     -- reception ticked "Booked ✓" after booking it in Dentally by hand
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
```

### 5.2 Row Level Security

Logged-in staff only see their own clinic. Webhooks, crons and patient pages use the admin (secret-key) client.

```sql
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
```

Notes on writes:

- **Pipeline writes** (Approve, Booked ✓, manual expire) happen in server actions. Each action first checks the session and the role, then uses the admin client and `transitionStage()`. This keeps one code path for stage changes.
- **Team management** also uses the admin client, after permission checks (§6.8).

---

## 6. Core domain logic

### 6.1 Stages and transitions (`lib/constants.ts`, `lib/pipeline.ts`)

Board column order:

1. `cancellation_detected`
2. `offer_sent`
3. `waiting_staff_approval`
4. `slot_recovered`
5. `expired_manual`

| Stage | Label on board | Tone |
| --- | --- | --- |
| cancellation_detected | Cancellation detected / "Detected" | muted grey |
| offer_sent | Offer sent | blue (link) |
| waiting_staff_approval | Patient said YES — awaiting front-desk approval / "Awaiting approval" | amber (warning) |
| slot_recovered | Slot recovered / "Recovered" | green (success) |
| expired_manual | Expired / manual | red (destructive) |

```ts
const ALLOWED: Record<Stage, Stage[]> = {
  cancellation_detected: ['offer_sent', 'waiting_staff_approval', 'slot_recovered', 'expired_manual'],
  offer_sent: ['offer_sent', 'waiting_staff_approval', 'slot_recovered', 'expired_manual'], // offer_sent→offer_sent = next patient
  waiting_staff_approval: ['offer_sent', 'slot_recovered', 'expired_manual'],               // →offer_sent = reception declined, try next
  slot_recovered: [],
  expired_manual: [],
};
const STAGE_TIMESTAMP = { offer_sent: 'offer_sent_at', waiting_staff_approval: 'approval_requested_at',
  slot_recovered: 'confirmed_at', expired_manual: 'expired_at' };
```

How `transitionStage(db, { pipeline, to, triggeredBy, note, fields })` works:

1. It rejects a disallowed move with `ApiError(409, 'invalid_transition')`.
2. It updates with `.eq('id', id).eq('stage', pipeline.stage)`. This is an **optimistic lock**: if 0 rows change, it throws `409 stage_conflict`. That stops two webhooks or two clicks from double-moving a card.
3. It sets the stage timestamp.
4. It inserts a `recovery_pipeline_history` row.

`logHistory()` writes notes without a stage change (`from_stage = to_stage`).

### 6.2 Matching (`lib/waitlist-matching.ts`)

The function is pure:

```
matchWaitlist(candidates, { datetime, procedure, doctor, timeZone }, now)
```

**Hard filters:**

- The patient is active and has not opted out of SMS (if SMS is the only channel they have).
- Hours until the slot must be **≥** the patient's `max_notice_hours`. This value is really the *minimum notice the patient needs*.
- Procedure: the patient accepts any procedure (empty list), or the slot has no procedure, or there is an exact match.
- Not already offered this slot (exclude the `waitlist_offers` for this pipeline).

**Score:**

```
base = exact procedure match ? 0.70 : 0.50
+ day bonus     : list empty → +0.10 ; contains slot weekday (clinic tz) → +0.15 ; else 0
+ time bonus    : list empty → +0.10 ; contains slot time-of-day → +0.15 ; else 0
                  (morning < 12:00 ≤ afternoon < 17:00 ≤ evening, clinic tz)
+ dentist       : slot dentist in preferred_doctors → +0.10 ; no preference/unknown → 0 ; prefers someone else → −0.15
round to 2 dp
```

Doctor names are compared after normalising: lowercase, strip a leading "dr"/"dr.", collapse spaces.

**Sort:** score descending, then least-recently contacted first (`last_contacted_at` null = never = first).

Each result gets `preferred_doctor_match: 'yes' | 'no' | 'any'`. If the value is `'no'`, the offer text adds: "This slot is with Dr X, not your usual dentist."

### 6.3 Pricing (`lib/pricing.ts`)

```
PROCEDURES = cleaning, consultation, filling, extraction, crown, implant, whitening
getProcedurePrice(config, procedure) → config.price_<procedure> or price_default if unknown/missing
```

- The price is snapshotted into `recovery_pipeline.procedure_price` at detection.
- `revenue_saved` is set from that snapshot on recovery.

### 6.4 Offer state (`lib/offers.ts`)

```
getOfferState(offer, pipeline, now):
  offer.response = accepted  → 'accepted'
  offer.response = declined  → 'declined'
  pipeline.stage in (slot_recovered, expired_manual) → 'slot_unavailable'
  offer.response = expired OR offer_expires_at < now → 'expired'
  else 'open'
```

The patient's response is handled by `respondToOffer(db, token, 'accepted'|'declined', via)`:

1. **Validate the token.** It must be a UUID; load offer + pipeline + event + clinic + patient (admin client). An unknown token shows `slot_unavailable`.
2. **Check the state.** If the state is not `open`, return the state. The page shows the matching message.
3. **Record the answer atomically:** `UPDATE waitlist_offers SET response, responded_at, responded_via WHERE id = ? AND response = 'pending'`. If 0 rows changed, it was a double tap; return the current state.
4. **On YES** (and stage is `offer_sent`):
   - `transitionStage → waiting_staff_approval` with `waitlist_patient_id`, `approval_token = randomUUID()` and `approval_token_expires_at = now + approval_window_minutes`;
   - expire this pipeline's *other* pending offers (batch mode);
   - call **E6 notifyReception()**.
5. **On NO:** log history, then call **E8 advance(pipeline)** to offer the next patient now.
6. **If the stage move fails because of a race,** still keep the patient's answer and log it. Never lose a YES.

### 6.5 Waitlist sign-up dedupe (`lib/waitlist-optin.ts`)

On a public `/join` submit:

- If a row with the same `phone` OR `email` already exists in this clinic, update it and set `is_active = true`.
- Otherwise insert with `opt_in_source = 'sms_link'` and `added_by = 'Patient (sign-up link)'`.

### 6.6 Phone normalisation (`lib/validation.ts`)

```
normalizeUkPhone(raw): strip spaces ()-; must match ^\+?\d{7,15}$ ;
  "+..." keep · "00..." → "+..." · "0..." → "+44..." · else "+" + digits ; invalid → null
```

### 6.7 Dentally waitlist sync plan (`lib/waitlist-sync.ts`, optional E5)

This applies if the clinic keeps a "short notice" list in Dentally.

```
planWaitlistSync(input, byPms, byContact):
  byPms     = row with same pms_patient_id
  byContact = unlinked row (pms_patient_id null) with same phone/email AND same name (families share phones)
  target = byPms ?? byContact
  no target: inactive → 'ignored'; missing name or contact → 400; else 'created'
             (opt_in_source 'pms', existing_patient true, added_by 'Dentally short-notice list')
  target:   !is_active → 'deactivated' ; byPms → 'updated' ; else 'linked' (sets pms_patient_id)
```

If an insert fails with a unique violation (`23505`), retry once as an update. Two syncs can race.

### 6.8 Team permissions (`lib/team-permissions.ts`)

| Action | Owner (exactly 1) | Admin | Staff |
| --- | --- | --- | --- |
| Use the CRM | ✓ | ✓ | ✓ |
| Invite | admin or staff | staff only | ✗ |
| Change role admin ↔ staff | ✓ (not the owner) | ✗ | ✗ |
| Remove member | anyone except self/owner | staff only | ✗ |
| Transfer ownership | to an existing member (old owner → admin) | ✗ | ✗ |

**Invite:**

- If the email has no account, call `auth.admin.inviteUserByEmail(email, { redirectTo: APP_URL + '/auth/confirm?next=/set-password' })`, then insert into `clinic_users`.
- If the account already exists, just insert into `clinic_users`. They sign in with their existing password.

### 6.9 Metrics (`lib/metrics.ts`)

Ranges are **rolling**: `week` = 7, `month` = 30, `quarter` = 90 days, including today. Rows are pipelines with `created_at` in the range.

| Metric | How it's calculated |
| --- | --- |
| `slots_total` | Number of rows |
| `slots_recovered` | Number of rows in `slot_recovered` |
| `recovery_rate` | `recovered / total`, 3 decimal places |
| `revenue_saved` | Sum of `revenue_saved` for recovered rows |
| `avg_fill_time_minutes` | Mean of (`confirmed_at` − `detected_at` or `created_at`), rounded |
| `by_stage` | Count per stage |
| `by_procedure` | Recovered count per procedure |
| `trend[]` | Per day in the clinic timezone: `{ date, recovered (by confirmed_at), expired (by expired_at) }` |

`bucketTrend(trend, 31)` keeps daily bars up to 31 days. Beyond that it uses weekly buckets; the first bucket may be shorter, and totals are preserved.

---

## 7. The engine — modules E1–E10

Build them in this order. Each module is a small, tested unit.

### E1 — Dentally client · `lib/dentally/client.ts`

**`dentallyFetch(path, init)`:**

- base URL from `DENTALLY_API_BASE_URL`;
- headers: `Authorization: Bearer DENTALLY_API_TOKEN`, a descriptive `User-Agent` (e.g. `CancellationRecovery/1.0 (you@domain)`), JSON;
- timeout 10 s;
- retry 429/5xx with exponential backoff (max 3);
- typed `DentallyError` (status, type, params).

**Functions:**

- `getAppointment(id)`
- `listAppointments({ updatedSince, from, to })`
- `getPatient(id)`
- `listPractitioners()`
- `listTreatments()`, if available

**Read-only:** the clinic gives us a read-only token, so the client only makes `GET` requests. `dentallyFetch` throws on any other method, so a coding mistake can never try to write to a clinic's diary.

**Confirm in Dentally's API docs / sandbox:**

- exact base URL and versioning;
- endpoint names;
- pagination style;
- appointment **state** values (what "cancelled" looks like);
- whether deleted appointments are reported;
- rate limits.

**Tests:** mock `fetch` (200, 401, 422 with params, 429 → retry → 200), and a non-GET call is rejected.

### E2 — Cancellation intake · `lib/engine/intake.ts` + webhook + poller

**`ingestCancellation(db, normalised)`:**

1. If `pms_appointment_id` already exists, return the existing pipeline (`duplicate: true`).
2. Ignore it if the slot is in the past, sooner than `min_lead_minutes`, or beyond `max_horizon_hours`. Still log it with a note so reception sees it.
3. Insert the `cancellation_events` row. If inserting the pipeline fails, delete the event (keep the pair atomic).
4. Insert the `recovery_pipeline` row: `stage = cancellation_detected`, `detected_at`, `procedure_price`.
5. Log history: "Cancellation logged from Dentally".
6. If `engine_enabled`, call **E4 startOffers(pipeline)**.

**Webhook — `POST /api/webhooks/dentally/[secret]`:**

- The clinic admin adds the URL `https://<app>/api/webhooks/dentally/<DENTALLY_WEBHOOK_SECRET>` in Dentally (Settings → Developer → Webhooks). Subscribe to appointment created/updated/deleted.
- Compare the `secret` path segment with `safeEqual`. If Dentally offers a signature header, verify that as well (check the docs).
- Save `engine_state.last_webhook_at`.
- For appointment **updated**, re-fetch the appointment (never trust the payload alone). If its state is the cancelled state, normalise and ingest. **Deleted** counts as a cancellation only if the slot is in the future.
- Always reply `200` quickly, even for events we ignore. **Dentally deactivates a webhook after many failed deliveries (reported: 50)**, so E10 monitors it.

**Normaliser — `lib/dentally/normalise.ts`:**

- converts a Dentally appointment to `{ slot_datetime, slot_duration_minutes, procedure_type, doctor_id, doctor_name, cancelled_patient_*, cancellation_reason, pms_appointment_id, raw_payload }`;
- maps treatment/reason text to our `PROCEDURES` with a small keyword map (e.g. "hygiene", "scale" → cleaning; "exam", "check" → consultation). Unknown → `null`, which uses `price_default` and matches "any" patients;
- maps the practitioner id → name via `config.doctors[].id`, falling back to the API name.

**Poller — `GET /api/cron/dentally-poll` (every 5 min):**

- `listAppointments({ updatedSince: engine_state.last_poll_at − 2 min })`, then the same normaliser and `ingestCancellation`;
- save `last_poll_at`. Idempotency makes the overlap safe.

**Manual entry (also v1 without Dentally):** an "Add cancellation" button on the board opens a dialog with date/time, duration, procedure and dentist. It creates the event with `pms_source = 'manual'`. This lets you sell to clinics on any PMS on day one.

### E3 — Matching

Use §6.2. `getCandidates(db, clinicId, pipelineId)`:

- loads active waitlist rows;
- excludes patients already in `waitlist_offers` for this pipeline;
- excludes `sms_opt_out` patients that have no email.

### E4 — Offers out · `lib/engine/offer.ts`, `lib/sms.ts`, `lib/email.ts`

**`startOffers(pipeline)` / `offerNext(pipeline)`:**

1. Load the config. Stop if `!engine_enabled`, if the slot is sooner than `min_lead_minutes`, or if offers so far ≥ `max_offers_per_slot`. Stopping means → **E8 giveUp**.
2. **Quiet hours:** if now (clinic tz) is inside quiet hours, don't send. Schedule the send at `quiet_hours_end` by storing `engine_state['deferred:<pipelineId>']`; the tick cron picks it up. If the slot is before then, give up.
3. Pick candidates: 1 for `sequential`, `batch_size` for `batch`. None → **E8 giveUp**.
4. For each candidate, insert a `waitlist_offers` row with `offer_token = randomUUID()` and `offer_expires_at = now + offer_expiry_minutes`, and set `waitlist.last_contacted_at = now`.
5. Move the stage: `transitionStage → offer_sent`, with `waitlist_patient_id` = the first candidate and a note like "Offer sent to Sarah K. (SMS + email)".
6. Send on each channel in `offer_channels`:
   - **SMS:** if the patient has a phone and is not opted out → `sendSms()` with the §10.2 text.
   - **Email:** if the patient has an email → the `slotOfferEmail` HTML with an "Answer now" button.
   - **WhatsApp:** if enabled → an approved template with the link (or quick replies).
7. In **shadow mode,** replace the recipient with `SHADOW_TEST_PHONE` / `SHADOW_TEST_EMAIL` and prefix the body with `[TEST for <patient name>]`.

**`sendSms({ to, body, clinicId, pipelineId, offerId, patientId })`:**

- Twilio `messages.create({ to, body, from or messagingServiceSid, statusCallback: APP_URL + '/api/webhooks/twilio/status' })`;
- insert a `messages` row (out, `provider_id = sid`, `status`);
- never throws; returns a boolean.
- **Length:** aim for ≤ 160 GSM-7 characters (1 segment). Avoid emojis and curly quotes; they switch to UCS-2 with 70 characters per segment and cost more.

**Delivery status webhook — `POST /api/webhooks/twilio/status`:**

- verify the signature;
- update `messages.status` / `error` by `MessageSid`.
- A failed SMS plus no email → note on the card "SMS failed — call patient".

### E5 — Inbound SMS replies · `POST /api/webhooks/twilio/inbound`

1. Verify `X-Twilio-Signature` with `twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, fullUrl, formParams)`. Use the **exact public URL** configured in Twilio. Reject with 403 if invalid.
2. Read the form fields `From`, `Body` and `MessageSid`. Insert a `messages` row (in, `status = received`). Ignore duplicates by `MessageSid`.
3. Normalise the body: trim, uppercase, strip punctuation.
   - `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`: set `sms_opt_out = true` and `sms_opt_out_at`, deactivate the waitlist row, and decline any pending offer. Note that Twilio may already handle STOP at carrier level; record it anyway.
   - `YES`, `Y`, `YEAH`, `YEP`, `OK`, `👍`: find the **most recent pending, unexpired offer** for a waitlist row with this phone, then `respondToOffer(token, 'accepted', 'sms_reply')`.
   - `NO`, `N`, `NOPE`: same lookup, then `respondToOffer(token, 'declined', 'sms_reply')`.
   - Anything else: log history "Patient replied: '<text>'" on the latest pipeline and leave it for reception. Reply with "Thanks — the practice will get back to you."
4. Respond with TwiML (`<Response><Message>…</Message></Response>`) for the confirmation text (§10.2), or an empty `<Response/>`.

If two family members share a phone and both have pending offers, take the most recent offer. The link in the SMS is the precise path, which is why the link is primary.

### E6 — Front-desk approval · `lib/engine/approve.ts`

**`notifyReception(pipeline)`**, called when the patient says YES:

- **CRM:** the card in "Awaiting approval" shows **Approve** and **Offer to next patient** buttons, plus patient phone, slot, procedure and dentist. The page polls every 30 s (or uses Supabase Realtime) so it updates live.
- **Email** to `clinics.contact_email`: "Sarah K. said YES to Tue 14:30 — tap to approve". The button links to `/approve/<approval_token>`. That page needs login; after login it shows the card details with Approve / Offer to next. The token only identifies the pipeline; the session authorises the action.
- **Slack (primary approval, when `slack_enabled`):** post one message to `SLACK_CHANNEL_ID` with the slot, patient name, phone, procedure, dentist and £ value, plus two Block Kit buttons: **Approve** (`approve:<pipelineId>:<approval_token>`) and **Offer to next** (`next:<pipelineId>:<approval_token>`). Save the message id in `slack_message_ts`.
  - Interactivity URL: `/api/webhooks/slack/actions`.
  - Verify `X-Slack-Signature`: `v0=` + HMAC-SHA256(`SLACK_SIGNING_SECRET`, `v0:${timestamp}:${rawBody}`). Reject if the timestamp is older than 5 min. Reject a button whose token doesn't match the pipeline's `approval_token`.
  - A click runs the same `approveBooking()` / offer-next functions as the CRM. The actor is the Slack user (id + display name from the payload). `approved_by` stays `NULL` because Slack users have no CRM login; the history note says "Approved in Slack by <name>".
  - Slack wants a reply within 3 seconds. Do the stage change first, answer `200`, and send the confirmation emails afterwards with `after()` from `next/server` so they still finish on Vercel.
  - After **any** approval path (Slack, CRM or the email link) update the Slack message with `chat.update` to "✅ Approved by <name>" or "↪ Offered to the next patient", so old buttons never stay live. A second tap shows "Already approved".
  - Anyone in the channel can press the buttons, so the channel must be front-desk only (§15).
  - If posting to Slack fails, the CRM card and the email still go out.
- Set `front_desk_notified_via` (`slack` if the Slack post succeeded, otherwise `email`).

**`approveBooking(pipelineId, actor)`** (shared by the CRM button, the /approve page and Slack; `actor` is a CRM user or a Slack user):

1. Allowed only from `waiting_staff_approval`.
2. Already `slot_recovered` for the same patient → return `already_confirmed`. For another patient → 409.
3. Approval window expired → still allow a manual approve, but warn: "approval was late — check the slot is still free".
4. **Move to recovered** (booking is always manual, because the Dentally token is read-only):
   - `transitionStage → slot_recovered`, with `approved_at`, `approved_by` (CRM user, or `NULL` for Slack), `revenue_saved = procedure_price`;
   - mark this patient's offer `accepted` (create the offer row if missing) and all other pending offers `expired`;
   - the card shows a **"Book in Dentally" checklist** (patient name, DOB if known, phone, slot, dentist, treatment) and a **Booked ✓** button that sets `booked_in_pms_at`.
5. **Emails** (never block the transition):
   - patient: "Your appointment is confirmed";
   - doctor: "New appointment: <patient> — <when>", CC reception. If the doctor has no email, send it to reception only.
   - Log history: "Confirmation email — patient: sent/not sent, doctor: …, reception: …".

**"Offer to next patient"** (reception declines the YES, e.g. the patient isn't suitable):

- mark the offer `declined` and note "declined by reception";
- `transitionStage → offer_sent` via `offerNext()`.

**Approval window reminder:** the tick cron re-sends the reception email once at 50% of `approval_window_minutes`. If the slot is about to start (< `min_lead_minutes`) and still unapproved, it moves to `expired_manual` and sends an alert.

### E7 — Booking into Dentally (manual only)

- Clinics give us a **read-only** Dentally token, so the system never writes to Dentally. Booking is always manual: after Approve, the card shows the **"Book in Dentally" checklist** and reception books it in about 20 seconds, then taps **Booked ✓**.
- API booking (find or create the patient, create the appointment) is **dropped**, because it would need a token that can write. There is no `booking_mode` setting.

### E8 — Advance: NO / expiry → next patient · `lib/engine/advance.ts`

**`advance(pipeline)`:**

- if stage is `offer_sent` and no offer is still pending/open, call `offerNext(pipeline)`;
- if none are left, or the slot is too close, call `giveUp`.

**`giveUp(pipeline, reason)`:**

- `transitionStage → expired_manual` with a note like "Expired: no waitlist match / nobody accepted / slot too close";
- expire pending offers;
- send `slotExpiredAlertEmail` to reception: "Slot still unfilled — manual follow-up needed", including how many patients were offered.

**Tick cron — `GET /api/cron/offers-tick` (every 1 min):**

1. Pending offers with `offer_expires_at < now` → set `response = 'expired'`, then `advance(pipeline)`.
2. Deferred (quiet-hours) pipelines whose time has come → `offerNext`.
3. Approval reminders and approval timeouts (E6).
4. Pipelines in `cancellation_detected` older than 2 min while the engine is enabled → `startOffers` (self-healing).

**Concurrency:** cron runs can overlap, so each step relies on the optimistic stage lock plus `WHERE response = 'pending'` updates. Optionally take a Postgres advisory lock per run (`pg_try_advisory_lock`).

### E9 — Scheduling

**Option 1 (recommended): Supabase `pg_cron` + `pg_net`.**

```sql
select cron.schedule('offers-tick', '* * * * *',
  $$ select net.http_get(url := 'https://<app>/api/cron/offers-tick',
       headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')) $$);
select cron.schedule('dentally-poll', '*/5 * * * *', $$ ... /api/cron/dentally-poll ... $$);
select cron.schedule('health-check', '0 * * * *', $$ ... /api/cron/health-check ... $$);
```

You can store the secret in Supabase Vault instead of inline.

**Option 2: Vercel Cron** (`vercel.json` → `crons`). Check your Vercel plan: lower tiers limit how often crons can run, and per-minute needs a paid plan.

Every cron route checks `Authorization: Bearer CRON_SECRET` with `safeEqual`. Otherwise it returns 401.

### E10 — Monitoring and health

**`GET /api/health`** (secret-protected) returns:

- DB OK;
- `last_webhook_at`, `last_poll_at`;
- pending offers count;
- SMS failures in the last hour;
- engine enabled / shadow mode.

**`health-check` cron (hourly)** emails `OPERATOR_ALERT_EMAIL` if any of these is true:

- no Dentally webhook for 24 h on a weekday while the poller *did* find changes. That means the webhook was probably deactivated; re-enable it in Dentally.
- the poller failed 3 times in a row;
- the Twilio failure rate is above 20% in an hour;
- an offer has been stuck pending past expiry for more than 10 min (the cron is not running).

`recovery_pipeline_history` + `messages` are the audit trail for clinic questions and GDPR requests.

---

## 8. HTTP routes

### 8.1 Public / patient

| Route | Auth | What it does |
| --- | --- | --- |
| `GET /join/[slug]` | none | Sign-up form for the clinic's waitlist. 404 if the slug is unknown or inactive. |
| server action `joinClinicWaitlist(slug, form)` | none | Validate with `publicJoinSchema`. A filled honeypot field returns fake success. Dedupe (§6.5). |
| `GET /confirm/[token]` | token | Offer page: open → YES/NO buttons; other states → message (§9.10). `robots: noindex`. |
| server action `respond(token, 'accepted'|'declined')` | token | `respondToOffer(..., 'link')`. |

### 8.2 Webhooks and crons

| Route | Auth |
| --- | --- |
| `POST /api/webhooks/dentally/[secret]` | path secret (+ signature if available) |
| `POST /api/webhooks/twilio/inbound` | `X-Twilio-Signature` |
| `POST /api/webhooks/twilio/status` | `X-Twilio-Signature` |
| `POST /api/webhooks/slack/actions` | `X-Slack-Signature` |
| `GET /api/cron/offers-tick`, `/dentally-poll`, `/health-check` | `Bearer CRON_SECRET` |
| `GET /api/health` | `Bearer CRON_SECRET` |

### 8.3 Staff (session) server actions

| Area | Server actions |
| --- | --- |
| Waitlist | `saveWaitlistPatient(form)` (add/edit), `setWaitlistActive(id, bool)`, `removeWaitlistPatient(id)` (permanent delete for erasure requests; offers cascade; recovered pipelines keep revenue, patient link → null) |
| Settings | `saveClinicConfig(form)`: reception email, 8 prices, doctors list, engine settings (owner/admin only) |
| Team | `inviteMember`, `changeMemberRole`, `removeMember`, `transferOwnership` |
| Pipeline | `approve(pipelineId)`, `offerNextPatient(pipelineId)`, `markBooked(pipelineId)`, `markExpired(pipelineId, reason)`, `addManualCancellation(form)`, `startOffersNow(pipelineId)` |
| QR | `GET /crm/config/qr` returns the PNG (download) of the join URL |

### 8.4 Optional external API (`/api/v1/*`, `Authorization: Bearer EXTERNAL_API_KEY`, ≥ 32 chars)

Only needed if another tool or partner will integrate. Same shapes as the internal functions:

- `POST /api/v1/cancellation`: body = normalised cancellation. Returns `{ cancellation_event_id, pipeline_id, stage, procedure_price }` (201) or `{ duplicate: true, ... }`.
- `GET /api/v1/waitlist?slot_datetime=&procedure=&doctor=&limit=`: returns `{ matches[], total_matches }`.
- `POST /api/v1/waitlist`: sync one PMS patient (§6.7).
- `GET /api/v1/metrics?range=week|month|quarter`: returns §6.9.

Compare keys with `safeEqual` (SHA-256 both, then `timingSafeEqual`).

---

## 9. Pages and UI

The shell is a left sidebar on desktop and a sheet menu on mobile. Nav items:

- Dashboard
- Pipeline
- Waitlist
- Activity
- Settings
- Team

The header shows the clinic name and the user's email/role. `proxy.ts`:

- refreshes the Supabase session on every request (`auth.getClaims()`);
- redirects logged-out users from `/crm*` and `/dashboard*` to `/login?next=...`;
- redirects logged-in users away from `/login`.

The matcher excludes `api/`, `confirm/`, `join/` and static assets.

### 9.1 Auth pages

- **`/login`:** email + password (Supabase `signInWithPassword`). Then go to a safe `next` (same-origin paths only) or `/dashboard`.
- **`/forgot-password`:** sends a reset email with redirect `/auth/confirm?next=/set-password`.
- **`/auth/confirm`:** exchanges the token hash (`verifyOtp`), then redirects to `next`.
- **`/set-password`:** new password (8–72 chars) + confirm.
- **`/no-access`:** "Your login isn't linked to a clinic yet."

### 9.2 Dashboard `/dashboard`

- Range tabs: Week / Month / Quarter.
- Stat tiles: **Revenue saved (£)**, **Slots recovered** ("of N cancellations"), **Recovery rate %**, **Average fill time** (minutes, or "—").
- **Recovery trend chart:** bars, recovered vs expired.
- **Recovered by procedure:** horizontal bars.
- **Recent recoveries:** list of the last 6, with patient, slot, procedure, £.
- An empty state when there's no data: "When a cancellation comes in, it will show up here."

### 9.3 Pipeline board `/crm`

- Five Kanban columns in stage order, each with a count badge. Mobile: horizontal scroll or stacked sections.
- **Card contents:**
  - slot date/time (clinic tz), procedure, dentist;
  - the cancelled patient (small);
  - the current offered/accepted patient;
  - £ value;
  - time in stage;
  - offer countdown ("expires in 9 min").
- **Awaiting approval cards:** amber, with **Approve** / **Offer to next patient** and the patient's phone (tap to call).
- **Recovered + not yet booked:** a "Book in Dentally" checklist and **Booked ✓**.
- **Expired / manual:** shows the reason and how many patients were offered.
- Tooltip on the Awaiting-approval column: "The patient accepted the offer. Approve to confirm; then book it in Dentally."
- Top-right button: **Add cancellation** (manual).
- The card links to the patient page.

### 9.4 Waitlist `/crm/waitlist`

- Table columns: name, contact (phone/email), preferred treatments, dentist, days/times, minimum notice, source, existing patient, last contacted, Active switch.
- Search box and an active/inactive filter.
- **Add patient / Edit** dialog fields (`waitlistPatientFormSchema`):
  - name;
  - email;
  - phone (at least one of email/phone);
  - treatment chips;
  - day chips;
  - time chips;
  - preferred dentists (chips from Settings → Doctors);
  - minimum notice hours (0–336);
  - existing patient checkbox;
  - notes.
- **Remove** dialog: "This permanently deletes the patient (use for erasure requests). Their recovered slots keep their revenue."
- A badge "Opted out of SMS" when `sms_opt_out`.

### 9.5 Patient page `/crm/patient/[id]`

- Contact, preferred treatments, existing patient, preferred dentist, days & times, minimum notice, notes.
- **History:** every offer (slot, offered at, response, via) and recoveries.
- Messages (SMS/email) for this patient.

### 9.6 Activity `/crm/activity`

- A timeline of `recovery_pipeline_history`, newest first: time, card, from → to, note, actor.
- Filter by actor: All / System / Engine / Front desk / Patient / Manual.

### 9.7 Settings `/crm/config` (owner/admin can edit; staff read-only)

1. **Reception email:** CC'd on every booking email and receives approvals and alerts.
2. **Procedure prices (£):** 7 procedures + default.
3. **Doctors:** list of `{id, name, email}`, used for doctor emails and preferred-dentist chips. Add a "Import from Dentally" button (E1 `listPractitioners`).
4. **Recovery engine:**
   - on/off;
   - shadow mode;
   - channels;
   - offer expiry minutes;
   - strategy sequential/batch and batch size;
   - max offers per slot;
   - minimum lead minutes;
   - quiet hours;
   - approval window;
   - Slack on/off.
5. **Waitlist sign-up link:**
   - the URL `APP_URL/join/<slug>` with a copy button;
   - QR preview;
   - **Download QR (PNG)**;
   - **Print QR card** (opens `/crm/config/qr-card`).
6. **Integration status:** Dentally connected (last webhook/poll time), Twilio OK, email OK, Slack OK. Each has a "Send test" button (test SMS/email to yourself, a test message to the Slack channel, and for Dentally a read-only call).

### 9.8 Team `/crm/team`

- Member table: email, role, joined, actions according to §6.8.
- Invite form: email + role (only the roles the actor may give).
- "Transfer ownership" with a confirmation dialog.

### 9.9 Public join page `/join/[slug]`

- Clinic name and a short line: "Join our short-notice list — we'll text you if an earlier appointment opens."
- **Fields:**
  - full name;
  - **mobile** (required);
  - **email** (required);
  - treatments wanted (chips; none = any);
  - preferred days and times (chips);
  - preferred dentist (chips; none = any);
  - minimum notice (select: same day / 2 h / 24 h / 48 h → hours);
  - "I'm already a patient here" checkbox.
- **Required consent checkbox:** "I'm happy for <clinic> to contact me by text and email about earlier appointments. I can reply STOP at any time."
- A link to the clinic privacy notice.
- A hidden honeypot field `website`.
- Success state: "You're on the list. We'll be in touch when a slot opens."

### 9.10 Offer page `/confirm/[token]` (mobile-first, no login)

- **Open:** "Hi Sarah, a slot just opened for you", then the slot day/time, procedure, dentist, clinic name, address and phone, plus "held for you until 14:05".
  - Two big buttons: **Yes, book me in** / **No thanks**.
  - If the dentist is different: "This slot is with Dr X, not your usual dentist."
- **Result states:**

| State | Message |
| --- | --- |
| accepted | "Thank you — we've got your reply. The practice will confirm your booking shortly." |
| declined | "No problem. We'll keep you on the list for the next opening." |
| expired | "This offer has expired. We'll be in touch when the next slot opens." |
| slot_unavailable | "This slot has been filled. We'll keep you on the list for the next one." |

### 9.11 Print QR card `/crm/config/qr-card`

An A5/A6 printable card for reception:

- clinic name;
- "Want an earlier appointment? Scan to join our short-notice list";
- large QR (error correction M, dark #0f172a on white);
- the short URL underneath;
- a **Print** button (hidden in print CSS).

---

## 10. Emails and SMS/WhatsApp copy

### 10.1 Emails (`lib/email-templates.ts`)

Every email has a plain-text version plus simple inline-styled HTML: Arial, 15 px, button navy `#1e3a5f`, white text, 6 px radius. HTML-escape all values. The From name is the clinic name and the address is the clinic's domain, so replies go to the clinic.

| Template | To | Subject |
| --- | --- | --- |
| `slotOfferEmail` | patient | `Earlier appointment available — Tue 14 Oct, 14:30` |
| `approvalRequestEmail` | reception | `Sarah K. said YES — approve Tue 14:30?` |
| `patientConfirmationEmail` | patient | `Your appointment is confirmed — <Clinic>` |
| `doctorNotificationEmail` | doctor, CC reception | `New appointment: <Patient> — <when>` |
| `slotExpiredAlertEmail` | reception | `Slot still unfilled — manual follow-up needed` |

What each one says:

- **`slotOfferEmail`:** "Hi Sarah, a <procedure> appointment with <dentist> has just become available on <day date time>. It's held for you for <N> minutes (until <time>)." Then the [Answer now] button, the other-dentist note if relevant, and "If you no longer want these messages, reply to this email."
- **`approvalRequestEmail`:** patient name and phone, slot, procedure, dentist, £ value, then the [Approve] button → `/approve/<token>`. Plus "Please approve within <approval_window_minutes> minutes."
- **`patientConfirmationEmail`:** slot, dentist, clinic address and phone, and "If you can't make it, please call us."
- **`doctorNotificationEmail`:** patient name/phone/email, slot, procedure, and "replaces cancelled appointment of <name>".
- **`slotExpiredAlertEmail`:** slot, procedure, dentist, "<n> waitlist patients were offered", and a CRM link.

Each clinic's Brevo SMTP is also Supabase Auth's SMTP, so invites and password resets come from the clinic's domain.

### 10.2 SMS copy (`lib/sms-templates.ts`) — GSM-7 characters only, ≤ 160 where possible

| Use | Text |
| --- | --- |
| Offer | `{Clinic}: a {procedure} slot {Tue 14 Oct 14:30} with {Dr Ali} is free. Want it? {link} or reply YES/NO. Held {N} min. STOP to opt out` (`{N}` = `offer_expiry_minutes`, default 30) |
| Offer (other dentist) | Add: `(with Dr X, not your usual dentist)` — shorten the clinic name if over 160 |
| YES received | `Thanks! {Clinic} will confirm your booking shortly.` |
| NO received | `No problem, we'll keep you on the list.` |
| Too late / filled | `Sorry, that slot has now gone. We'll text you next time.` |
| Booked | `Confirmed: {Tue 14 Oct 14:30} at {Clinic}. Can't make it? Call {phone}.` |
| STOP | `You won't get more texts from {Clinic}. Reply START to rejoin.` |
| Unknown reply | `Thanks, the practice will get back to you.` |

Use a short link: your own domain with the token, e.g. `{APP_URL}/c/{token}` redirecting to `/confirm/{token}`. That saves about 20 characters.

### 10.3 WhatsApp (later)

- Create one Utility template, e.g. `slot_offer` with variables {{1}} clinic, {{2}} slot, {{3}} dentist, and quick-reply buttons **YES** / **NO**. Submit it for approval via Twilio.
- Button replies arrive at the same inbound webhook (as `ButtonPayload`/`Body`). Handle them exactly like SMS YES/NO with `responded_via = 'whatsapp'`.

---

## 11. Design language

- **Feel:** calm, clinical, trustworthy; lots of white; navy + blue accents; no gradients.
- **Colour tokens** (CSS variables in `globals.css`, mapped into Tailwind `@theme`):

| Token | Value |
| --- | --- |
| background | `#f8fafc` |
| foreground | `#0f172a` |
| card | `#ffffff` |
| primary (navy) | `#1e3a5f` (text on it: white) |
| secondary / muted | `#f1f5f9` |
| muted-foreground | `#64748b` |
| accent (hover) | `#eff6ff` |
| link / ring | `#2563eb` |
| success | `#16a34a` |
| warning | `#d97706` |
| destructive | `#dc2626` |
| border / input | `#e2e8f0` |

- **Radius** 0.5 rem.
- **Font:** Geist Sans (`next/font`).
- **Motion:** sub-300 ms, ease-out `cubic-bezier(0.23,1,0.32,1)`.
- **Components** (shadcn-style): Button, Card, Badge (stage tones), Dialog, Sheet (mobile nav), Input, Label, Native select, Switch, Table, Textarea, Choice chips (toggle pills for multi-select), Copy field, Stat tile, Range tabs.
- **Accessibility:**
  - visible focus ring;
  - labels on every input;
  - 44 px tap targets on patient pages;
  - colour never the only signal (badges also have text).
- **Copy:** UK English, short sentences, no jargon for patients.

---

## 12. Environment variables

`.env.example` (commit this one). The real values go in `.env.local` and the clinic's Vercel project.

```
# App
NEXT_PUBLIC_APP_URL=https://recovery.clinic.co.uk
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
# Email (clinic's Brevo)
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=appointments@clinic.co.uk
SMTP_FROM_NAME=Smile Dental Clinic
# Dentally
DENTALLY_API_BASE_URL=
DENTALLY_API_TOKEN=               # READ-ONLY token created by the clinic's Dentally admin
DENTALLY_WEBHOOK_SECRET=          # long random string used in the webhook URL path
# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_MESSAGING_SERVICE_SID=     # or TWILIO_SMS_FROM=+44...
TWILIO_WHATSAPP_FROM=             # later, e.g. whatsapp:+44...
# Slack (front-desk approval; set when the clinic uses Slack)
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_CHANNEL_ID=
# Engine / ops
CRON_SECRET=                      # ≥ 32 random chars
OPERATOR_ALERT_EMAIL=you@yourdomain.com
SHADOW_TEST_PHONE=+447...
SHADOW_TEST_EMAIL=you@yourdomain.com
EXTERNAL_API_KEY=                 # optional §8.4, ≥ 32 chars
```

`lib/env.ts` validates them with Zod:

- **Required server vars** (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `CRON_SECRET`): throw a readable error listing every missing key.
- **Email, Twilio and Slack groups:** `null` if not configured. Those features then skip gracefully and log.
- **`NEXT_PUBLIC_*` vars:** read literally, so Next can inline them.

---

## 13. One isolated system per clinic — `scripts/clinic-setup.mjs`

**Per clinic:**

- a Supabase project (London);
- a Vercel project (same Git repo, its own env);
- a Brevo account;
- a Twilio sub-account or number;
- the clinic's Dentally token.

Every clinic runs the **same code**. Only the env differs.

**Steps:**

1. `cp clinics/clinic.example.env clinics/<slug>.env` (gitignored). Fill in:
   - `CLINIC_NAME`, `CLINIC_SLUG`, `CLINIC_EMAIL`, `CLINIC_PHONE`, `CLINIC_ADDRESS`;
   - `MANAGER_EMAIL`, `APP_URL`;
   - `SUPABASE_PROJECT_REF` (20 characters), `SUPABASE_ACCESS_TOKEN` (`sbp_...`);
   - `SMTP_*`;
   - `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`;
   - Dentally (read-only token), Twilio and Slack values.
2. Run `pnpm clinic:setup clinics/<slug>.env`. Use `--dry-run` to check the file and print the plan. Every step is **safe to re-run** and skips what's done:
   1. read the Supabase keys via the Management API;
   2. apply pending `supabase/migrations/*.sql` (track applied migrations in a table);
   3. configure Supabase Auth: Site URL = APP_URL, redirect URLs `APP_URL/auth/confirm`, the clinic's Brevo as SMTP, invite and reset email templates;
   4. create the clinic row and the `clinic_config` row once;
   5. invite the practice manager as **owner** (email from the clinic's Brevo);
   6. generate `CRON_SECRET` and `DENTALLY_WEBHOOK_SECRET` once, and save them back into the clinic file;
   7. push all env vars to the clinic's Vercel project (or write `clinics/<slug>.vercel.env` to paste);
   8. create the `pg_cron` jobs pointing at APP_URL;
   9. print the webhook URLs to paste into Dentally, Twilio and Slack (interactivity URL).
3. `pnpm clinic:migrate-all` applies a new migration to every clinic in `clinics/*.env`.
4. Onboarding checklist per clinic:
   - DPA signed;
   - prices and doctors in Settings;
   - QR card printed;
   - Dentally read-only token received and webhook added;
   - Twilio number webhooks set;
   - Slack app installed in the clinic's workspace, front-desk-only channel chosen, interactivity URL set;
   - one week in **shadow mode**;
   - then engine on with shadow off.

---

## 14. Testing

**Vitest unit tests** (pure functions; no network):

- `pipeline`: allowed transitions; stage-lock conflict; history row written.
- `waitlist-matching`:
  - notice filter;
  - procedure filter;
  - day/time bonuses in the clinic tz (including BST/GMT change days);
  - dentist match yes/no/any;
  - sort ties by `last_contacted_at`;
  - slot in the past → empty.
- `pricing`: known, unknown and missing procedure.
- `offers`: `getOfferState` for all 5 states; `respondToOffer` double tap; a YES moves to awaiting approval; a NO calls advance.
- `metrics`: totals, rate, average fill time, trend days, `bucketTrend` keeps totals.
- `waitlist-sync`: created / linked (name match) / not linked (name differs) / updated / deactivated / ignored.
- `team-permissions`: the full matrix.
- `validation`: `normalizeUkPhone` cases; join schema requires phone + email + consent.
- `sms-templates`: every template ≤ 160 GSM-7 characters with realistic long values; no non-GSM characters.
- **Inbound parser:** YES/NO/STOP variants; family phone picks the latest offer.
- **Signatures:** Twilio and Slack verification with known fixtures.
- **Dentally normaliser:** fixtures for updated-cancelled, deleted and past slot.
- **Slack actions:** Approve, then a second tap → "already approved" (no double booking); a wrong token is rejected; approving in the CRM updates the Slack message; `approved_by` is `NULL` and the history note names the Slack user.

**`scripts/simulate-flow.mjs`:** an end-to-end run against a dev Supabase:

1. create a test clinic and 3 waitlist patients;
2. post a fake cancellation;
3. assert the offer row exists;
4. respond NO to the first patient → the second gets an offer;
5. respond YES;
6. approve;
7. assert `slot_recovered` + `revenue_saved` + emails attempted.

Add `--fast` to shrink the expiry to 1 min and test the cron path.

**Before each pilot:** a full shadow-mode week with real cancellations.

---

## 15. Security checklist

- RLS on every table (§5.2). The secret key is only on the server (never `NEXT_PUBLIC_`).
- All webhook routes verify signatures or secrets. All cron routes check `CRON_SECRET`. Use constant-time compare everywhere.
- Offer tokens: random UUID v4, single-use answer, expiry, `noindex`. Approval tokens: UUID, and approving also needs a staff session.
- Zod on every input. HTML-escape email content.
- Safe redirects only (`next` must start with `/` and not `//`).
- Rate-limit the public `/join` and `/confirm` (e.g. by IP via Vercel Firewall or a small table). Keep the honeypot.
- Secrets only in env. Rotate on staff changes. The Dentally token is read-only (created by the clinic) and the client only allows `GET`.
- Slack buttons act for anyone in the channel, so keep the approval channel front-desk only. Verify the Slack signature and the approval token on every click.
- Never log full patient payloads in production logs. `raw_payload` stays in the DB (RLS-protected).
- Dependency updates monthly; `pnpm audit`.

---

## 16. UK compliance (not legal advice)

- **Roles:**
  - the clinic is the **data controller**; you are the **data processor**;
  - sign a **DPA** with each clinic;
  - list sub-processors: Supabase, Vercel, Brevo, Twilio, Slack (the clinic's own workspace; approval messages contain the patient's name and phone, so keep the channel front-desk only) and Dentally as the clinic's own system (read-only token).
- **ICO:** check whether your business must pay the ICO data protection fee.
- **Lawful basis and consent:**
  - only contact patients who joined the waitlist (consent checkbox / reception recorded consent);
  - every SMS includes STOP;
  - honour STOP immediately (E5);
  - respect quiet hours.
  - PECR applies to marketing. Appointment offers to patients who asked for them are service messages, but keep them strictly about the appointment, with no promotions.
- **Data location:** Supabase London region; Vercel functions region `lhr1`.
- **Retention:** e.g. delete inactive waitlist patients after 12 months and messages after 24 months. Make it configurable and put it in the DPA.
- **Rights:** erasure = "Remove" on the waitlist (hard delete). An export of a patient's data on request = patient page data.
- **DPIA:** a short template per clinic; clinics often ask for one.
- **Security statement:** a one-page summary (RLS, encryption at rest and in transit, isolated system per clinic, access roles).
- Admin/booking software that makes no clinical decisions is generally not a medical device. Keep it that way: no triage or clinical advice.

---

## 17. Pricing and selling

- **Pilot pricing used so far:** **£250 setup + £300/month** per clinic. Revisit after 3 case studies.
- Your costs per clinic: Supabase + Vercel + Brevo tiers, Twilio per-SMS cost and number rental, and your support time. Check current prices and keep a sheet.
- **Pilot pack:**
  - a demo board with fake data;
  - a 2-min screen video;
  - the DPA;
  - a privacy notice paragraph for the clinic's website;
  - the onboarding checklist;
  - "shadow mode" for the first week;
  - a weekly email report (revenue saved).
- **Don't claim numbers you can't source.** Use the clinic's own dashboard numbers after the pilot as proof.
- Leads come from LinkedIn (practice managers, principal dentists), dental Facebook groups, local outreach and the CQC directory (§18).

---

## 18. Other sectors, CQC leads, USA

### 18.1 Which PMS a clinic uses (to know if Dentally is the right connector)

- **CQC reports do not list the software.**
- **Check the website:** look at the online booking / patient portal link. If it opens a Dentally-hosted page, or the page source (Ctrl+U → search "dentally") mentions it, that's a strong sign.
- **Job ads** (Indeed, NHS Jobs): "experience with Dentally/SOE/R4/Pearl".
- **Dentally's case studies** and testimonials.
- **Best: just ask** on the first call: "Which practice software do you use?"
- **Manual-entry mode** (E2) lets you serve non-Dentally clinics anyway.

**PMS clue table (from real checks, 2026-10-17):**

| Clue in booking URL / page source (Ctrl+U / ⌥⌘U) | PMS | Example |
| --- | --- | --- |
| `dentally` anywhere (domain, portal link, script) | **Dentally** | — |
| `hsone.app/soe/...` or `JarvisAnalyticsScheduler` / "Jarvis" | **SOE / Exact** (Software of Excellence) | Acorn Dental, Moseley — `booking.uk.hsone.app/soe/new/Acorn%20Dental` |
| `hsone` alone | **Henry Schein One** = parent company of BOTH Dentally and SOE — **not proof of Dentally**; look at the rest of the URL | — |
| `pearl` / `r4` | Pearl / R4 | — |
| Per Aman (not yet seen by us): `portal.dentally.co`, `dentally.app`, `dentally.co/portal`, `dentally-booking-widget.js` | Dentally | — |
| Per Aman (not yet seen by us): `onlinebooking.soe.co.uk`, `soebridge` | SOE / Exact | — |
| Per Aman: `carestreamdental`, `practiceworks` | Carestream / R4 | — |
| No booking link at all | Google "[Practice Name] Dentally", or old dental-nurse job ads on Indeed (they often name the PMS) → else ask on the call | — |
| `dentalhub.online/soe/...` (often a floating side button, not in the menu) | **SOE / Exact** | All Saints Dental Clinic — `uk.dentalhub.online/soe/new/All%20Saints%20Dental%20Clinic` (found on its Patient Portal page / side button) |
| Only a website contact form, no booking link anywhere | Unknown → ask on the call | — |

Rule: a contact form is the website's own form and never shows the PMS. Only an online-booking or patient-portal link can — check side/floating buttons and the Patient Portal page too, then search the page source for `/soe/`, `dentally`, `hsone`, `dentalhub`. Non-Dentally clinics can still use the system in **manual cancellation mode** (E2).

### 18.2 CQC as a lead source (England only)

CQC registers providers that do regulated activities:

- GP practices;
- independent doctors and private clinics;
- private dental practices;
- aesthetic and cosmetic clinics doing regulated procedures;
- diagnostic and imaging centres;
- some physio/sports clinics (only if regulated activities);
- private hospitals;
- care homes;
- home-care agencies;
- community health services.

Other UK nations have their own regulators: Healthcare Improvement Scotland, Healthcare Inspectorate Wales, and RQIA in Northern Ireland.

**Best fit for this product:** private, paid, appointment-based clinics. NHS GP practices are a weak fit (free appointments, NHS systems).

### 18.3 Other sectors (only PMS connector + wording change)

| Sector | Fit | PMS to check for an API |
| --- | --- | --- |
| Private dental | ★★★ | Dentally (others need checking) |
| Physio / chiro / osteo | ★★★ | Cliniko, Jane, WriteUpp, Pabau |
| Aesthetics / skin | ★★★ | Pabau, Phorest |
| Private GP / private paediatrics | ★★ | Semble, Heydoc, Cliniko (NHS ones: EMIS/SystmOne — not a target) |
| Optometry / audiology / podiatry | ★★ | Optix, Optisoft, Cliniko |
| Veterinary | ★★★ | Provet Cloud, ezyVet |
| Hair / beauty | ★★ | Phorest, Fresha |

Always confirm in each PMS's developer docs that you can read cancellations and (ideally) create bookings.

### 18.4 USA

It's possible later, but it's a different product legally and technically:

- **Data law:** **HIPAA** applies, and you need a **BAA** with each clinic *and* with every vendor that touches patient data (hosting, DB, SMS, email). This often means higher-tier plans.
- **SMS rules:** **TCPA** consent and **A2P 10DLC** registration.
- **PMS:** Open Dental, Dentrix, Eaglesoft, Curve, Denticon.
- **Competition:** a crowded market (Weave, NexHealth and others).

Win the UK first.

---

## 19. Build plan

| Phase | Build | Done when |
| --- | --- | --- |
| **1. Foundation** (2–3 days) | Next.js app, Tailwind tokens, UI components, Supabase schema + RLS (§5), env validation, auth pages, proxy, app shell, session context | You can log in, see an empty dashboard and board, and RLS tests pass |
| **2. CRM core** (4–5 days) | Waitlist CRUD, patient page, Settings (prices/doctors/reception email), Team + roles, `/join` + QR + print card, Activity, manual "Add cancellation", board with stages, `transitionStage` | A receptionist can manage the waitlist and see a manual cancellation on the board |
| **3. Offer loop without PMS** (5–6 days) | Matching, `startOffers`, email offer, `/confirm` page, `respondToOffer`, approval (Slack one-tap + CRM + email + `/approve`), confirmation emails, expiry tick cron + advance + giveUp, dashboard metrics | A manual cancellation → email offer → YES → Approve (in Slack or the CRM) → Recovered, with all emails; NO and expiry move to the next patient |
| **4. SMS** (3 days) | Twilio send + status webhook, inbound YES/NO/STOP, SMS templates, quiet hours, shadow mode | A test phone gets the SMS; replying YES moves the card; STOP opts out |
| **5. Dentally** (4–6 days, sandbox) | E1 read-only client (GET only), webhook, normaliser, poller, practitioner import, health monitoring | A cancellation in the Dentally sandbox appears on the board within 1 min and the offer goes out |
| **6. Hardening + multi-clinic** (3–4 days) | `clinic-setup.mjs`, `migrate-all`, pg_cron jobs, rate limits, operator alerts, simulate script, docs | A new clinic set up from one env file in under 30 min; full simulated loop passes |
| **7. Pilot** (1–2 weeks) | Shadow week → live; weekly report email | First real slot recovered |
| Later | WhatsApp template, batch strategy polish | — |

---

## 20. Prompts for Claude (one phase at a time)

- "Read SYSTEM_BUILD_GUIDE.md completely. Set up Phase 1: Next.js 16 + Tailwind 4 with the §11 tokens, the shadcn-style components listed, Supabase clients (§3.3), the schema and RLS SQL from §5 as migrations, `lib/env.ts`, the auth pages (§9.1), `proxy.ts` and the app shell. Add Vitest. Stop when Phase 1 'done when' is true."
- "Phase 2: build §9.3–9.9 and §6.5/6.6/6.8 with tests. Use `transitionStage` (§6.1) for every stage change."
- "Phase 3: build §6.2–6.4, §6.9, E3, E4 (email only), E6 (Slack one-tap + CRM + email), E8 and the offers-tick cron, plus `/confirm` and the §10.1 emails. Add the tests from §14."
- "Phase 4: build E4 SMS + E5 inbound + Twilio status webhook + §10.2 templates, with signature verification, quiet hours and shadow mode."
- "Phase 5: build E1 (GET only), E2 (webhook + normaliser + poller), practitioner import and E10. Use fixtures; I'll test against the Dentally sandbox."
- "Phase 6: build `scripts/clinic-setup.mjs` exactly as §13, plus `simulate-flow.mjs` from §14."

After each phase:

- update `README.md` (what exists, how to run);
- update `HOW_IT_WORKS.md` (plain-English flow for clinics);
- tick §22.

---

## 21. Other products to sell later (same building blocks)

1. **Missed-call text-back:** an unanswered call → instant SMS with a booking link.
2. **Treatment-plan follow-up:** high-value plans not accepted → a polite 2–3 week sequence.
3. **Recall / reactivation:** patients overdue for a check-up → batch SMS + booking link; dashboard of re-booked revenue.
4. **New-enquiry speed-to-lead:** website, Facebook, Instagram or WhatsApp enquiries → instant reply, assigned to reception, with a 15-min reminder.
5. **Google review requests** after completed appointments.
6. **Deposit / no-show protection:** Stripe deposit links for long or high-value appointments.
7. **Membership-plan failed-payment chaser.**
8. **Practice KPI dashboard:** utilisation, cancellations, recoveries, revenue.
9. **After-hours AI receptionist:** FAQs and capturing details only, never clinical advice.
10. **Lab case tracker.**

Bundle: **"Front-desk autopilot"** = cancellation recovery + missed-call text-back + treatment-plan follow-up, one monthly price.

---

## 22. Progress checklist

- [x] Phase 1 — foundation (schema, RLS, auth, shell)
- [x] Phase 2 — CRM core (waitlist, patient, settings, team, join + QR, activity, board, manual cancellation)
- [ ] Phase 3 — offer loop (matching, email offer, /confirm, approval incl. Slack one-tap, confirmations, expiry → next, dashboard)
- [ ] Phase 4 — SMS out, inbound YES/NO/STOP, status, quiet hours, shadow mode
- [ ] Phase 5 — Dentally client, webhook, poller, health monitoring
- [ ] Phase 6 — clinic setup script, migrate-all, crons, simulate script
- [ ] Phase 7 — first pilot live
- [ ] Later — WhatsApp · batch strategy
- [ ] Compliance pack — DPA, DPIA, privacy notice text, ICO check, retention policy
