-- Real Row Level Security checks against the real migrations (guide §5, §15).
-- Run by scripts/rls-check.sh on a throwaway local Postgres. Any failure raises an exception.

CREATE SCHEMA test;
GRANT USAGE ON SCHEMA test TO PUBLIC;

CREATE FUNCTION test.assert_eq(label TEXT, actual BIGINT, expected BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'RLS FAIL: % (expected %, got %)', label, expected, actual;
  END IF;
END $$;

-- Act like a Supabase API request: set the JWT claims and drop to the API role (for this transaction).
CREATE FUNCTION test.act_as(uid UUID, r TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', r)::text, true);
  EXECUTE format('SET LOCAL ROLE %I', r);
END $$;

-- ---------------------------------------------------------------------------
-- Seed (as superuser). Two clinics, four users.
--   u1  = clinic A owner      u1b = clinic A staff
--   u2  = clinic B owner      u3  = signed in but linked to no clinic
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-4111-8111-111111111111', 'u1@a.test'),
  ('11111111-2222-4222-8222-222222222222', 'u1b@a.test'),
  ('22222222-2222-4222-8222-222222222222', 'u2@b.test'),
  ('33333333-3333-4333-8333-333333333333', 'u3@nowhere.test');

INSERT INTO public.clinics (id, name, slug) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Clinic A', 'clinic-a'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'Clinic B', 'clinic-b');

INSERT INTO public.clinic_users (user_id, clinic_id, role) VALUES
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner'),
  ('11111111-2222-4222-8222-222222222222', 'aaaaaaaa-0000-4000-8000-000000000001', 'staff'),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-0000-4000-8000-000000000002', 'owner');

INSERT INTO public.clinic_config (clinic_id) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000002');

INSERT INTO public.waitlist (id, clinic_id, patient_name, phone) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Alice', '+447700900001'),
  ('a2a2a2a2-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'Anna',  '+447700900002'),
  ('b1b1b1b1-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000002', 'Bob',   '+447700900003');

INSERT INTO public.cancellation_events (id, clinic_id, slot_datetime, pms_source) VALUES
  ('eaeaeaea-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', now() + interval '1 day', 'manual'),
  ('ebebebeb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', now() + interval '1 day', 'manual');

INSERT INTO public.recovery_pipeline (id, clinic_id, cancellation_event_id, waitlist_patient_id) VALUES
  ('9a9a9a9a-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'eaeaeaea-0000-4000-8000-000000000001', 'a1a1a1a1-0000-4000-8000-000000000001'),
  ('9b9b9b9b-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'ebebebeb-0000-4000-8000-000000000002', 'b1b1b1b1-0000-4000-8000-000000000003');

INSERT INTO public.recovery_pipeline_history (pipeline_id, from_stage, to_stage) VALUES
  ('9a9a9a9a-0000-4000-8000-000000000001', NULL, 'cancellation_detected'),
  ('9b9b9b9b-0000-4000-8000-000000000002', NULL, 'cancellation_detected');

INSERT INTO public.waitlist_offers (pipeline_id, waitlist_patient_id, offer_token) VALUES
  ('9a9a9a9a-0000-4000-8000-000000000001', 'a1a1a1a1-0000-4000-8000-000000000001', '0a0a0a0a-0000-4000-8000-000000000001'),
  ('9b9b9b9b-0000-4000-8000-000000000002', 'b1b1b1b1-0000-4000-8000-000000000003', '0b0b0b0b-0000-4000-8000-000000000002');

INSERT INTO public.messages (clinic_id, channel, direction, to_or_from, body) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'sms', 'out', '+447700900001', 'test A'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'sms', 'out', '+447700900003', 'test B');

INSERT INTO public.engine_state (clinic_id, key, value) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'last_poll_at', '"x"'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'last_poll_at', '"x"');

-- Sanity: the seed is really there (superuser sees everything).
DO $$ BEGIN
  PERFORM test.assert_eq('seed: clinics', (SELECT count(*) FROM public.clinics), 2);
  PERFORM test.assert_eq('seed: waitlist', (SELECT count(*) FROM public.waitlist), 3);
END $$;

-- ---------------------------------------------------------------------------
-- 1. RLS is enabled on every public table
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  PERFORM test.assert_eq('every public table has RLS enabled',
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity), 0);
  PERFORM test.assert_eq('engine_state has no policies (service role only)',
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'engine_state'), 0);
  PERFORM test.assert_eq('anon cannot run private.user_clinic_ids()',
    (SELECT has_function_privilege('anon', 'private.user_clinic_ids()', 'EXECUTE'))::int, 0);
  PERFORM test.assert_eq('authenticated can run private.user_clinic_ids()',
    (SELECT has_function_privilege('authenticated', 'private.user_clinic_ids()', 'EXECUTE'))::int, 1);
END $$;

-- ---------------------------------------------------------------------------
-- 2. Clinic A owner sees ONLY clinic A
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  PERFORM test.act_as('11111111-1111-4111-8111-111111111111', 'authenticated');
  PERFORM test.assert_eq('u1 clinics', (SELECT count(*) FROM public.clinics), 1);
  PERFORM test.assert_eq('u1 sees clinic A', (SELECT count(*) FROM public.clinics WHERE slug = 'clinic-a'), 1);
  PERFORM test.assert_eq('u1 clinic_users (own row only)', (SELECT count(*) FROM public.clinic_users), 1);
  PERFORM test.assert_eq('u1 clinic_config', (SELECT count(*) FROM public.clinic_config), 1);
  PERFORM test.assert_eq('u1 waitlist', (SELECT count(*) FROM public.waitlist), 2);
  PERFORM test.assert_eq('u1 cancellation_events', (SELECT count(*) FROM public.cancellation_events), 1);
  PERFORM test.assert_eq('u1 recovery_pipeline', (SELECT count(*) FROM public.recovery_pipeline), 1);
  PERFORM test.assert_eq('u1 history', (SELECT count(*) FROM public.recovery_pipeline_history), 1);
  PERFORM test.assert_eq('u1 offers', (SELECT count(*) FROM public.waitlist_offers), 1);
  PERFORM test.assert_eq('u1 messages', (SELECT count(*) FROM public.messages), 1);
  PERFORM test.assert_eq('u1 engine_state (none)', (SELECT count(*) FROM public.engine_state), 0);
END $$;

-- Clinic A staff sees the same clinic A data
DO $$ BEGIN
  PERFORM test.act_as('11111111-2222-4222-8222-222222222222', 'authenticated');
  PERFORM test.assert_eq('u1b clinics', (SELECT count(*) FROM public.clinics), 1);
  PERFORM test.assert_eq('u1b waitlist', (SELECT count(*) FROM public.waitlist), 2);
  PERFORM test.assert_eq('u1b clinic_users (own row only)', (SELECT count(*) FROM public.clinic_users), 1);
END $$;

-- Clinic B owner sees ONLY clinic B
DO $$ BEGIN
  PERFORM test.act_as('22222222-2222-4222-8222-222222222222', 'authenticated');
  PERFORM test.assert_eq('u2 clinics', (SELECT count(*) FROM public.clinics), 1);
  PERFORM test.assert_eq('u2 sees clinic B', (SELECT count(*) FROM public.clinics WHERE slug = 'clinic-b'), 1);
  PERFORM test.assert_eq('u2 waitlist', (SELECT count(*) FROM public.waitlist), 1);
  PERFORM test.assert_eq('u2 pipeline', (SELECT count(*) FROM public.recovery_pipeline), 1);
  PERFORM test.assert_eq('u2 offers', (SELECT count(*) FROM public.waitlist_offers), 1);
  PERFORM test.assert_eq('u2 messages', (SELECT count(*) FROM public.messages), 1);
END $$;

-- A signed-in user with no clinic sees nothing
DO $$ BEGIN
  PERFORM test.act_as('33333333-3333-4333-8333-333333333333', 'authenticated');
  PERFORM test.assert_eq('u3 clinics', (SELECT count(*) FROM public.clinics), 0);
  PERFORM test.assert_eq('u3 clinic_users', (SELECT count(*) FROM public.clinic_users), 0);
  PERFORM test.assert_eq('u3 clinic_config', (SELECT count(*) FROM public.clinic_config), 0);
  PERFORM test.assert_eq('u3 waitlist', (SELECT count(*) FROM public.waitlist), 0);
  PERFORM test.assert_eq('u3 events', (SELECT count(*) FROM public.cancellation_events), 0);
  PERFORM test.assert_eq('u3 pipeline', (SELECT count(*) FROM public.recovery_pipeline), 0);
  PERFORM test.assert_eq('u3 history', (SELECT count(*) FROM public.recovery_pipeline_history), 0);
  PERFORM test.assert_eq('u3 offers', (SELECT count(*) FROM public.waitlist_offers), 0);
  PERFORM test.assert_eq('u3 messages', (SELECT count(*) FROM public.messages), 0);
  PERFORM test.assert_eq('u3 engine_state', (SELECT count(*) FROM public.engine_state), 0);
END $$;

-- The anonymous role (no login) sees nothing
DO $$ BEGIN
  PERFORM test.act_as(NULL, 'anon');
  PERFORM test.assert_eq('anon clinics', (SELECT count(*) FROM public.clinics), 0);
  PERFORM test.assert_eq('anon waitlist', (SELECT count(*) FROM public.waitlist), 0);
  PERFORM test.assert_eq('anon offers (tokens are not readable via the API)', (SELECT count(*) FROM public.waitlist_offers), 0);
  PERFORM test.assert_eq('anon pipeline (approval tokens are not readable)', (SELECT count(*) FROM public.recovery_pipeline), 0);
  PERFORM test.assert_eq('anon messages', (SELECT count(*) FROM public.messages), 0);
END $$;

-- ---------------------------------------------------------------------------
-- 3. Clinic A owner cannot write into clinic B, or escalate privileges
-- ---------------------------------------------------------------------------
DO $$
DECLARE n INT;
BEGIN
  PERFORM test.act_as('11111111-1111-4111-8111-111111111111', 'authenticated');

  -- insert into the other clinic is rejected
  BEGIN
    INSERT INTO public.waitlist (clinic_id, patient_name, phone)
    VALUES ('bbbbbbbb-0000-4000-8000-000000000002', 'Mallory', '+447700900099');
    RAISE EXCEPTION 'RLS FAIL: cross-clinic waitlist insert was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- update / delete of the other clinic's rows touches 0 rows
  UPDATE public.waitlist SET patient_name = 'Hacked' WHERE id = 'b1b1b1b1-0000-4000-8000-000000000003';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM test.assert_eq('cross-clinic waitlist update', n, 0);
  DELETE FROM public.waitlist WHERE id = 'b1b1b1b1-0000-4000-8000-000000000003';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM test.assert_eq('cross-clinic waitlist delete', n, 0);
  UPDATE public.clinic_config SET price_cleaning = 1 WHERE clinic_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM test.assert_eq('cross-clinic config update', n, 0);

  -- moving an own row into the other clinic is rejected (WITH CHECK)
  BEGIN
    UPDATE public.waitlist SET clinic_id = 'bbbbbbbb-0000-4000-8000-000000000002'
    WHERE id = 'a1a1a1a1-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'RLS FAIL: moving a waitlist row to another clinic was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- privilege escalation through clinic_users is rejected
  BEGIN
    INSERT INTO public.clinic_users (user_id, clinic_id, role)
    VALUES ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-0000-4000-8000-000000000002', 'staff');
    RAISE EXCEPTION 'RLS FAIL: joining another clinic was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.clinic_users SET role = 'owner' WHERE user_id = '11111111-2222-4222-8222-222222222222';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM test.assert_eq('role change through the API', n, 0);
  DELETE FROM public.clinic_users WHERE user_id = '11111111-2222-4222-8222-222222222222';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM test.assert_eq('member removal through the API', n, 0);

  -- clinics themselves cannot be edited through the API
  UPDATE public.clinics SET name = 'Renamed' WHERE slug = 'clinic-a';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM test.assert_eq('clinic update through the API', n, 0);
END $$;

-- ---------------------------------------------------------------------------
-- 4. Pipeline / offers / messages / engine_state are read-only through the API
--    (stage changes go through the server with the admin client, guide §5.2 notes)
-- ---------------------------------------------------------------------------
DO $$
DECLARE n INT;
BEGIN
  PERFORM test.act_as('11111111-1111-4111-8111-111111111111', 'authenticated');

  UPDATE public.recovery_pipeline SET stage = 'slot_recovered', revenue_saved = 9999 WHERE clinic_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM test.assert_eq('pipeline stage update through the API', n, 0);

  UPDATE public.waitlist_offers SET response = 'accepted' WHERE pipeline_id = '9a9a9a9a-0000-4000-8000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM test.assert_eq('offer update through the API', n, 0);

  BEGIN
    INSERT INTO public.recovery_pipeline (clinic_id, cancellation_event_id)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'eaeaeaea-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'RLS FAIL: pipeline insert through the API was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.recovery_pipeline_history (pipeline_id, to_stage)
    VALUES ('9a9a9a9a-0000-4000-8000-000000000001', 'slot_recovered');
    RAISE EXCEPTION 'RLS FAIL: history insert through the API was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.messages (clinic_id, channel, direction, to_or_from, body)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'sms', 'out', '+447700900001', 'fake');
    RAISE EXCEPTION 'RLS FAIL: messages insert through the API was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.engine_state (clinic_id, key, value)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'x', '1');
    RAISE EXCEPTION 'RLS FAIL: engine_state insert through the API was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- 5. What staff ARE allowed to do (own clinic): waitlist CRUD and config update
-- ---------------------------------------------------------------------------
DO $$
DECLARE n INT;
BEGIN
  PERFORM test.act_as('11111111-1111-4111-8111-111111111111', 'authenticated');

  INSERT INTO public.waitlist (clinic_id, patient_name, email)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'Carol', 'carol@example.com');
  PERFORM test.assert_eq('own waitlist insert', (SELECT count(*) FROM public.waitlist), 3);

  UPDATE public.waitlist SET notes = 'prefers mornings' WHERE patient_name = 'Carol';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM test.assert_eq('own waitlist update', n, 1);

  DELETE FROM public.waitlist WHERE patient_name = 'Carol';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM test.assert_eq('own waitlist delete', n, 1);

  UPDATE public.clinic_config SET price_cleaning = 160 WHERE clinic_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM test.assert_eq('own config update', n, 1);
END $$;

-- ---------------------------------------------------------------------------
-- 6. Data rules (checks, unique indexes, triggers, cascades), as superuser
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  BEGIN
    INSERT INTO public.clinic_users (user_id, clinic_id, role)
    VALUES ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner');
    RAISE EXCEPTION 'FAIL: a second owner was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.waitlist (clinic_id, patient_name) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'No contact');
    RAISE EXCEPTION 'FAIL: waitlist row without email or phone was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.waitlist (clinic_id, patient_name, phone, pms_patient_id)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'P1', '+447700900011', 'pms-1');
    INSERT INTO public.waitlist (clinic_id, patient_name, phone, pms_patient_id)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'P2', '+447700900012', 'pms-1');
    RAISE EXCEPTION 'FAIL: duplicate pms_patient_id in a clinic was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.recovery_pipeline SET stage = 'bogus' WHERE id = '9a9a9a9a-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'FAIL: invalid stage was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.waitlist_offers SET response = 'bogus' WHERE pipeline_id = '9a9a9a9a-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'FAIL: invalid offer response was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.clinic_config SET offer_expiry_minutes = 3 WHERE clinic_id = 'aaaaaaaa-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'FAIL: offer_expiry_minutes below 5 was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- same Dentally appointment twice in a clinic is rejected (idempotency key)
  BEGIN
    INSERT INTO public.cancellation_events (clinic_id, slot_datetime, pms_source, pms_appointment_id)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', now() + interval '2 days', 'dentally', 'appt-1');
    INSERT INTO public.cancellation_events (clinic_id, slot_datetime, pms_source, pms_appointment_id)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', now() + interval '2 days', 'dentally', 'appt-1');
    RAISE EXCEPTION 'FAIL: duplicate Dentally appointment was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- Twilio MessageSid duplicates are rejected
  BEGIN
    INSERT INTO public.messages (clinic_id, channel, direction, to_or_from, body, provider_id)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'sms', 'in', '+447700900001', 'YES', 'SM123');
    INSERT INTO public.messages (clinic_id, channel, direction, to_or_from, body, provider_id)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'sms', 'in', '+447700900001', 'YES', 'SM123');
    RAISE EXCEPTION 'FAIL: duplicate provider_id was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- updated_at trigger moves the timestamp forward
CREATE TABLE test.ts_before AS SELECT updated_at FROM public.clinics WHERE slug = 'clinic-a';
SELECT pg_sleep(0.05);
UPDATE public.clinics SET name = 'Clinic A (renamed)' WHERE slug = 'clinic-a';
DO $$ BEGIN
  PERFORM test.assert_eq('updated_at trigger fired',
    (SELECT (c.updated_at > t.updated_at)::int FROM public.clinics c, test.ts_before t WHERE c.slug = 'clinic-a'), 1);
END $$;

-- Erasure (guide §8.3): deleting a waitlist patient cascades offers and nulls the pipeline link
DELETE FROM public.waitlist WHERE id = 'b1b1b1b1-0000-4000-8000-000000000003';
DO $$ BEGIN
  PERFORM test.assert_eq('offers cascade on patient delete',
    (SELECT count(*) FROM public.waitlist_offers WHERE pipeline_id = '9b9b9b9b-0000-4000-8000-000000000002'), 0);
  PERFORM test.assert_eq('pipeline survives, patient link nulled',
    (SELECT count(*) FROM public.recovery_pipeline WHERE id = '9b9b9b9b-0000-4000-8000-000000000002' AND waitlist_patient_id IS NULL), 1);
END $$;

-- Removing an auth user removes their clinic membership
DELETE FROM auth.users WHERE id = '11111111-2222-4222-8222-222222222222';
DO $$ BEGIN
  PERFORM test.assert_eq('membership cascades on user delete',
    (SELECT count(*) FROM public.clinic_users WHERE user_id = '11111111-2222-4222-8222-222222222222'), 0);
END $$;

-- Guide v2.1 schema changes (migration 0003)
DO $$ BEGIN
  PERFORM test.assert_eq('booking_mode column is gone',
    (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='clinic_config' AND column_name='booking_mode'), 0);
  PERFORM test.assert_eq('pms_new_appointment_id column is gone',
    (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='recovery_pipeline' AND column_name='pms_new_appointment_id'), 0);
  PERFORM test.assert_eq('slack_message_ts column exists',
    (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='recovery_pipeline' AND column_name='slack_message_ts'), 1);
  PERFORM test.assert_eq('offer_expiry_minutes defaults to 30',
    (SELECT column_default::int FROM information_schema.columns WHERE table_schema='public' AND table_name='clinic_config' AND column_name='offer_expiry_minutes'), 30);
END $$;

-- Rate limits (migration 0004): service role only
DO $$ BEGIN
  PERFORM test.assert_eq('anon cannot run rate_limit_hit',
    (SELECT has_function_privilege('anon', 'public.rate_limit_hit(text,int,int)', 'EXECUTE'))::int, 0);
  PERFORM test.assert_eq('authenticated cannot run rate_limit_hit',
    (SELECT has_function_privilege('authenticated', 'public.rate_limit_hit(text,int,int)', 'EXECUTE'))::int, 0);
  PERFORM test.assert_eq('service_role can run rate_limit_hit',
    (SELECT has_function_privilege('service_role', 'public.rate_limit_hit(text,int,int)', 'EXECUTE'))::int, 1);
  PERFORM test.assert_eq('authenticated cannot read rate_limits',
    (SELECT has_table_privilege('authenticated', 'public.rate_limits', 'SELECT'))::int, 0);
  PERFORM test.assert_eq('rate limit allows up to the limit', (public.rate_limit_hit('t:x', 60, 2))::int, 1);
  PERFORM test.assert_eq('rate limit second hit allowed', (public.rate_limit_hit('t:x', 60, 2))::int, 1);
  PERFORM test.assert_eq('rate limit third hit blocked', (public.rate_limit_hit('t:x', 60, 2))::int, 0);
  PERFORM test.assert_eq('rate limit keys are independent', (public.rate_limit_hit('t:y', 60, 2))::int, 1);
END $$;

-- Monthly reports (migration 0006): clinic-scoped
INSERT INTO public.monthly_reports (clinic_id, month, data) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', '2026-09-01', '{"v":"A"}'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '2026-09-01', '{"v":"B"}');

DO $$
DECLARE v_blocked BOOLEAN := FALSE;
BEGIN
  PERFORM test.act_as('11111111-1111-4111-8111-111111111111', 'authenticated');
  PERFORM test.assert_eq('u1 sees only clinic A monthly reports', (SELECT count(*) FROM public.monthly_reports), 1);
  INSERT INTO public.monthly_reports (clinic_id, month, data) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', '2026-08-01', '{}');
  PERFORM test.assert_eq('u1 can save a report for clinic A', (SELECT count(*) FROM public.monthly_reports), 2);
  BEGIN
    INSERT INTO public.monthly_reports (clinic_id, month, data) VALUES ('bbbbbbbb-0000-4000-8000-000000000002', '2026-08-01', '{}');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE;
  END;
  PERFORM test.assert_eq('u1 cannot save a report for clinic B', v_blocked::int, 1);
  UPDATE public.monthly_reports SET data = '{"hacked":true}' WHERE clinic_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  PERFORM test.assert_eq('u1 cannot change clinic B reports', (SELECT count(*) FROM public.monthly_reports WHERE data ? 'hacked'), 0);
  BEGIN
    INSERT INTO public.monthly_reports (clinic_id, month, data) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', '2026-08-15', '{}');
  EXCEPTION WHEN check_violation THEN v_blocked := FALSE;
  END;
  PERFORM test.assert_eq('month must be the first day of a month', v_blocked::int, 0);
END $$;

DO $$ BEGIN
  PERFORM test.act_as(NULL, 'anon');
  PERFORM test.assert_eq('anon sees no monthly_reports', (SELECT count(*) FROM public.monthly_reports), 0);
END $$;

-- ---------------------------------------------------------------------------
-- 30-day purge (migration 0008). Runs inside a transaction that is rolled back.
-- ---------------------------------------------------------------------------
BEGIN;

INSERT INTO public.cancellation_events (id, clinic_id, slot_datetime, procedure_type, cancelled_patient_name, cancelled_patient_email, cancelled_patient_phone, cancellation_reason, raw_payload, pms_source) VALUES
  ('e0000001-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', now() - interval '60 days', 'cleaning', 'Old Slot', 'old@x.test', '+447700900101', 'ill', '{"a":1}', 'manual'),
  ('e0000002-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', now() + interval '2 days', 'filling', 'Closed Long Ago', 'closed@x.test', '+447700900102', 'work', '{"b":2}', 'manual'),
  ('e0000003-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', now() + interval '2 days', 'filling', 'Closed Recently', 'recent@x.test', '+447700900103', 'work', '{"c":3}', 'manual'),
  ('e0000004-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001', now() + interval '2 days', 'filling', 'Still Open', 'open@x.test', '+447700900104', 'work', '{"d":4}', 'manual');

INSERT INTO public.recovery_pipeline (id, clinic_id, cancellation_event_id, waitlist_patient_id, stage, confirmed_at, revenue_saved, procedure_price, notes, approved_by_name, approved_via, approved_at) VALUES
  ('f0000001-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'e0000001-0000-4000-8000-000000000001', 'a1a1a1a1-0000-4000-8000-000000000001', 'offer_sent', NULL, NULL, 100, 'staff note', NULL, NULL, NULL),
  ('f0000002-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'e0000002-0000-4000-8000-000000000002', 'a1a1a1a1-0000-4000-8000-000000000001', 'slot_recovered', now() - interval '40 days', 150, 150, NULL, 'Amy', 'slack', now() - interval '40 days'),
  ('f0000003-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'e0000003-0000-4000-8000-000000000003', 'a1a1a1a1-0000-4000-8000-000000000001', 'slot_recovered', now() - interval '5 days', 150, 150, NULL, 'Sam', 'portal', now() - interval '5 days'),
  ('f0000004-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001', 'e0000004-0000-4000-8000-000000000004', 'a1a1a1a1-0000-4000-8000-000000000001', 'offer_sent', NULL, NULL, 150, NULL, NULL, NULL, NULL);

INSERT INTO public.recovery_pipeline_history (pipeline_id, to_stage, note) VALUES
  ('f0000001-0000-4000-8000-000000000001', 'offer_sent', 'Offer sent to Alice'),
  ('f0000002-0000-4000-8000-000000000002', 'slot_recovered', 'Approved in Slack by Amy'),
  ('f0000003-0000-4000-8000-000000000003', 'slot_recovered', 'Approved by sam@a.test'),
  ('f0000004-0000-4000-8000-000000000004', 'offer_sent', 'Offer sent to Alice');

INSERT INTO public.waitlist_offers (id, pipeline_id, waitlist_patient_id, template_version) VALUES
  ('c0000002-0000-4000-8000-000000000002', 'f0000002-0000-4000-8000-000000000002', 'a1a1a1a1-0000-4000-8000-000000000001', 'offer-email-v1');

INSERT INTO public.messages (id, clinic_id, pipeline_id, offer_id, waitlist_patient_id, channel, direction, to_or_from, body, provider_id, status, created_at) VALUES
  ('d0000001-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'f0000001-0000-4000-8000-000000000001', NULL, NULL, 'sms', 'out', '+447700900001', 'Hi Alice, slot offer', 'SM1', 'delivered', now() - interval '59 days'),
  ('d0000002-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', NULL, 'c0000002-0000-4000-8000-000000000002', NULL, 'email', 'out', 'alice@x.test', 'Offer email', NULL, 'sent', now() - interval '41 days'),
  ('d0000003-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'f0000002-0000-4000-8000-000000000002', NULL, NULL, 'slack', 'out', 'channel', 'Approve?', NULL, 'sent', now() - interval '41 days'),
  ('d0000004-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001', NULL, NULL, 'a1a1a1a1-0000-4000-8000-000000000001', 'sms', 'in', '+447700900001', 'old unlinked reply', 'SM4', 'received', now() - interval '45 days'),
  ('d0000005-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001', NULL, NULL, 'a1a1a1a1-0000-4000-8000-000000000001', 'sms', 'in', '+447700900001', 'recent unlinked reply', 'SM5', 'received', now() - interval '2 days'),
  ('d0000006-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000001', 'f0000004-0000-4000-8000-000000000004', NULL, NULL, 'sms', 'out', '+447700900001', 'open job text', 'SM6', 'sent', now() - interval '1 day'),
  ('d0000007-0000-4000-8000-000000000007', 'aaaaaaaa-0000-4000-8000-000000000001', 'f0000003-0000-4000-8000-000000000003', NULL, NULL, 'email', 'out', 'alice@x.test', 'recent closed text', NULL, 'sent', now() - interval '5 days');

-- Snapshots to compare after the purge.
CREATE TEMP TABLE before_pipeline AS SELECT id, md5(p::text) AS h FROM public.recovery_pipeline p;
CREATE TEMP TABLE before_waitlist AS SELECT id, md5(w::text) AS h FROM public.waitlist w;
CREATE TEMP TABLE before_counts AS SELECT
  (SELECT count(*) FROM public.cancellation_events) AS e, (SELECT count(*) FROM public.recovery_pipeline) AS p,
  (SELECT count(*) FROM public.recovery_pipeline_history) AS h, (SELECT count(*) FROM public.messages) AS m,
  (SELECT count(*) FROM public.waitlist_offers) AS o, (SELECT count(*) FROM public.waitlist) AS w;
CREATE TEMP TABLE before_messages AS SELECT id, channel, direction, status, provider_id, created_at FROM public.messages;

DO $$
DECLARE r RECORD;
BEGIN
  -- Only the service role / owner may call it.
  PERFORM test.act_as('11111111-1111-4111-8111-111111111111', 'authenticated');
  BEGIN
    PERFORM private.purge_closed_job_personal_data();
    RAISE EXCEPTION 'PURGE FAIL: authenticated user could call the purge';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  PERFORM test.act_as(NULL, 'anon');
  BEGIN
    PERFORM private.purge_closed_job_personal_data();
    RAISE EXCEPTION 'PURGE FAIL: anon could call the purge';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  PERFORM test.act_as('11111111-1111-4111-8111-111111111111', 'authenticated');
  BEGIN
    PERFORM count(*) FROM public.purge_log;
    RAISE EXCEPTION 'PURGE FAIL: authenticated user could read purge_log';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  SELECT * INTO r FROM private.purge_closed_job_personal_data();
  PERFORM test.assert_eq('2 events scrubbed (old slot + long-closed)', r.events_scrubbed, 2);
  PERFORM test.assert_eq('2 history notes cleared', r.history_notes_cleared, 2);
  PERFORM test.assert_eq('4 messages scrubbed (3 job messages + 1 old unlinked)', r.messages_scrubbed, 4);
END $$;

DO $$
DECLARE r RECORD;
BEGIN
  -- Scrubbed.
  PERFORM test.assert_eq('old-slot event PII gone', (SELECT count(*) FROM public.cancellation_events WHERE id IN ('e0000001-0000-4000-8000-000000000001','e0000002-0000-4000-8000-000000000002') AND (cancelled_patient_name IS NOT NULL OR cancelled_patient_email IS NOT NULL OR cancelled_patient_phone IS NOT NULL OR cancellation_reason IS NOT NULL OR raw_payload IS NOT NULL)), 0);
  PERFORM test.assert_eq('recent and open events keep their data', (SELECT count(*) FROM public.cancellation_events WHERE id IN ('e0000003-0000-4000-8000-000000000003','e0000004-0000-4000-8000-000000000004') AND cancelled_patient_name IS NOT NULL AND raw_payload IS NOT NULL), 2);
  PERFORM test.assert_eq('event dates and procedure kept', (SELECT count(*) FROM public.cancellation_events WHERE id IN ('e0000001-0000-4000-8000-000000000001','e0000002-0000-4000-8000-000000000002') AND slot_datetime IS NOT NULL AND procedure_type IS NOT NULL), 2);
  PERFORM test.assert_eq('history notes of finished jobs cleared', (SELECT count(*) FROM public.recovery_pipeline_history WHERE pipeline_id IN ('f0000001-0000-4000-8000-000000000001','f0000002-0000-4000-8000-000000000002') AND note IS NOT NULL), 0);
  PERFORM test.assert_eq('history notes of recent/open jobs kept', (SELECT count(*) FROM public.recovery_pipeline_history WHERE pipeline_id IN ('f0000003-0000-4000-8000-000000000003','f0000004-0000-4000-8000-000000000004') AND note IS NOT NULL), 2);
  PERFORM test.assert_eq('finished-job and old unlinked messages replaced', (SELECT count(*) FROM public.messages WHERE id IN ('d0000001-0000-4000-8000-000000000001','d0000002-0000-4000-8000-000000000002','d0000003-0000-4000-8000-000000000003','d0000004-0000-4000-8000-000000000004') AND body = '[removed]' AND to_or_from = '[removed]'), 4);
  PERFORM test.assert_eq('open, recent-closed and recent unlinked messages untouched', (SELECT count(*) FROM public.messages WHERE id IN ('d0000005-0000-4000-8000-000000000005','d0000006-0000-4000-8000-000000000006','d0000007-0000-4000-8000-000000000007') AND body <> '[removed]' AND to_or_from <> '[removed]'), 3);

  -- Never deleted, never changed where reports and delivery stats look.
  PERFORM test.assert_eq('no table lost a row', (SELECT count(*) FROM before_counts b WHERE b.e = (SELECT count(*) FROM public.cancellation_events) AND b.p = (SELECT count(*) FROM public.recovery_pipeline) AND b.h = (SELECT count(*) FROM public.recovery_pipeline_history) AND b.m = (SELECT count(*) FROM public.messages) AND b.o = (SELECT count(*) FROM public.waitlist_offers) AND b.w = (SELECT count(*) FROM public.waitlist)), 1);
  PERFORM test.assert_eq('recovery_pipeline rows byte-identical (updated_at not bumped, reports unchanged)', (SELECT count(*) FROM before_pipeline b JOIN public.recovery_pipeline p ON p.id = b.id WHERE md5(p::text) <> b.h), 0);
  PERFORM test.assert_eq('waitlist rows byte-identical', (SELECT count(*) FROM before_waitlist b JOIN public.waitlist w ON w.id = b.id WHERE md5(w::text) <> b.h), 0);
  PERFORM test.assert_eq('message channel/direction/status/provider_id/created_at unchanged', (SELECT count(*) FROM before_messages b JOIN public.messages m ON m.id = b.id WHERE (m.channel, m.direction, m.status, m.provider_id, m.created_at) IS DISTINCT FROM (b.channel, b.direction, b.status, b.provider_id, b.created_at)), 0);
  PERFORM test.assert_eq('audit columns survive the purge', (SELECT count(*) FROM public.recovery_pipeline WHERE id = 'f0000002-0000-4000-8000-000000000002' AND approved_by_name = 'Amy' AND approved_via = 'slack' AND approved_at IS NOT NULL), 1);
  PERFORM test.assert_eq('offer template_version survives the purge', (SELECT count(*) FROM public.waitlist_offers WHERE template_version = 'offer-email-v1'), 1);

  -- Idempotent: a second run changes nothing.
  SELECT * INTO r FROM private.purge_closed_job_personal_data();
  PERFORM test.assert_eq('second run scrubs 0 events', r.events_scrubbed, 0);
  PERFORM test.assert_eq('second run clears 0 notes', r.history_notes_cleared, 0);
  PERFORM test.assert_eq('second run scrubs 0 messages', r.messages_scrubbed, 0);
  PERFORM test.assert_eq('one purge_log row per run', (SELECT count(*) FROM public.purge_log), 2);
  PERFORM test.assert_eq('purge_log records the 30-day retention', (SELECT count(*) FROM public.purge_log WHERE retention = interval '30 days'), 2);
END $$;

-- The audit CHECK only allows the real approval paths.
DO $$
DECLARE v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    UPDATE public.recovery_pipeline SET approved_via = 'carrier-pigeon' WHERE id = 'f0000004-0000-4000-8000-000000000004';
  EXCEPTION WHEN check_violation THEN v_blocked := TRUE;
  END;
  PERFORM test.assert_eq('approved_via rejects unknown channels', v_blocked::int, 1);
END $$;

ROLLBACK;

SELECT 'RLS_ALL_OK' AS result;
