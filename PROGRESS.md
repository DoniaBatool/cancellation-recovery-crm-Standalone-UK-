# PROGRESS.md

_Last updated: 2026-10-27 (Phases 3c, 4, 5, 6 coded and tested) · Owner: Donia_

## Overall: 29% verified done (Phases 1 and 2) — Phases 3 to 6 are fully coded and tested, waiting for live checks with real accounts

Percent = finished phases out of the 7 in guide §19, and a phase counts as done only when its "done when" is true. Phases 3 to 6 are **built** (about 86% of the code is in place), but their "done when" needs real Brevo, Twilio, Slack, Dentally and Vercel accounts, so they are **not ticked** in guide §22. What has been proven: 543 unit tests, the local RLS check, a production build, and `pnpm simulate` (normal and `--fast`) running the whole loop against the live dev database with a recording notifier.

| Phase | Build | Status |
| --- | --- | --- |
| 1. Foundation | Next.js app, tokens, UI components, schema + RLS (migrations 0001–0003, v2.1), env validation, auth pages, proxy, app shell | ✅ done 2026-10-26 |
| 2. CRM core | Waitlist, patient page, settings, team, join + QR, activity, board, manual cancellation | ✅ done 2026-10-26 |
| 3. Offer loop (no PMS) | Matching, email offers, /confirm, approval (Slack one-tap + CRM + email + /approve), confirmations, expiry tick, dashboard | 🔄 built + tested with mocks; needs a real Brevo send and a Slack click to be called done |
| 4. SMS | Twilio send/status/inbound, templates, quiet hours, shadow mode, STOP/START | ⏸ DEFERRED by Donia (2026-11-10): code is built and tested with mocks and stays in the repo, switched off; no Twilio work until a paying client asks |
| 5. Dentally | Read-only client (GET only), webhook, normaliser, poller, doctor import, health monitoring | 🔄 built + tested with fixtures; the Dentally API shapes are ASSUMED, to confirm in a sandbox |
| 6. Hardening + multi-clinic | clinic-setup script, migrate-all, pg_cron SQL, rate limits (migration 0004), simulate script | 🔄 built + tested; the simulate loop passes on the live dev DB; the setup script has not run against a real new clinic yet |
| 7. Pilot | Shadow week, then live | ⏳ not started |

## Scope decision (Donia, 2026-11-10)

No SMS, Twilio or WhatsApp work for now. It is added only when a paying client asks for it. Until then the product uses:
- **Slack** for the front desk (one-tap approval, alerts), plus the CRM board and the `/approve/<token>` email link as other ways to approve;
- **Email** for patient offers and for confirmations.

What this means in the repo: the SMS code (guide Phase 4, STOP-by-phone, the waitlist scrub, templates) stays as it is and is NOT removed. It is inactive because the Twilio env vars are not set: `lib/env.ts` then gives no SMS sender, the notifier offers email only, and `clinic_config.offer_channels` can keep its default `{sms,email}` (SMS is simply skipped). When a client wants SMS: set the `TWILIO_*` variables, point the two Twilio webhooks at the app, and run the Phase 4 live check (shadow mode first).

Heads-up (the guide's own reasoning, not changed): `SYSTEM_BUILD_GUIDE.md` calls SMS the main offer channel because email alone is slow, and the default offer hold time is 30 minutes. With email only, a slot may fill more slowly or expire more often. The guide text is not edited; tell Claude if you want it updated to match.

## Now

- Everything that can be built without Donia's accounts is built. Nothing is committed or pushed (Donia pushes herself).
- Live checks left, in this order: (1) Brevo email, (2) Slack one-tap, (3) Dentally sandbox, (4) `pnpm clinic:setup` on a real new clinic with Vercel, (5) one shadow-mode week (Phase 7). The Twilio SMS live check is deferred (see Scope decision).

## Next

1. Donia provides the accounts below (any one of them unlocks its live check; they are independent).
2. Run each live check, fix what real services reveal (especially the Dentally field names), then tick Phases 3 to 6 in guide §22.
3. Phase 7: shadow week at the first pilot clinic, then engine on and shadow off.

## Open items to remind Donia about (added 2026-11-07)

Claude: at the start of every session, after the 3–4 line status, remind Donia of these open items (one line each) until they are done. Tick or remove an item only when Donia confirms it is finished.

| # | Open item | When / who |
| --- | --- | --- |
| 1 | Scrub for **Booked** and **Removed / no reply** waitlist patients is not built. Decide the retention days with the first real clinic, then build it like the opted-out scrub (scrub never delete, idempotent, cron, tests). First define what "inactive" means: the engine does not set `is_active = false` on booking or no reply. See `DATA_RETENTION_STATUS.md`. | First real clinic |
| 2 | No cleanup exists for `recovery_pipeline.notes` (staff free text) and `rate_limits` (hashed IP rows). Both are OPEN in `DATA_RETENTION_STATUS.md`. | Before the DPA is signed |
| 3 | (Only needed once SMS is switched on for a client; deferred with SMS.) Add one line to the DPA and the privacy notice: "For patients who opt out of SMS, we keep only the phone number, as a suppression record, so they are not texted again." | Donia, before the first clinic |
| 4 | Dentally to waitlist sync is not wired (`lib/waitlist-sync.ts` is only a planner). When it is wired, its insert must use `inheritedOptOut()`. | Phase 5 |
| 5 | Small Supabase advisor warnings: (a) set `search_path` on `private.block_scrubbed_waitlist_reactivation()` (needs a new migration `0010`); (b) move `pg_net` out of the public schema; (c) turn on leaked password protection in Supabase Auth settings (do before real clinics). | Before the pilot |
| 6 | ✅ DONE 2026-11-07 (Claude inserted the three history rows; dev history now lists 0001–0009). Was: dev migration history table is missing `0007`, `0008`, `0009` (they were run in the SQL Editor; `0006` was recorded when Claude applied it on 2026-11-07). `pnpm clinic:migrate-all` skips a migration only if its version OR name is in the history, so on this dev project it would try to run 0007–0009 again and fail on `ADD COLUMN` (no data change, but an error). Fix: insert the three history rows (ask Claude for the SQL), and always run `--dry-run` first. Fresh clinics made with `clinic:setup` are not affected. Only matters if dev gets a `clinics/<slug>.env` file. | Before using `clinic:migrate-all` on dev |

## Blocked / needs Donia

**Accounts and keys (put values only in `.env.local` or the clinic file, never in chat):**

1. **Brevo** (free): account, SMTP key, a verified sender address or domain. Needed for offer emails, reception alerts, confirmations and for team invites (Supabase Auth must use the same SMTP; `pnpm clinic:setup` sets that up).
2. **Twilio — DEFERRED until a paying client asks for SMS:** account, a UK number or Messaging Service, then set the incoming-message URL to `APP_URL/api/webhooks/twilio/inbound` and the status callback to `APP_URL/api/webhooks/twilio/status`.
3. **Slack** (optional): a Slack app with a bot token, signing secret and a front-desk-only channel id; interactivity URL `APP_URL/api/webhooks/slack/actions`.
4. **Dentally sandbox:** a test account with a read-only API token and the base URL, and a webhook pointed at `APP_URL/api/webhooks/dentally/<DENTALLY_WEBHOOK_SECRET>`. **I need to see one real appointment JSON and one real webhook payload** to confirm the field names I assumed (see "Assumptions" below).
5. **Vercel project + real domain** (for example a slotrefill domain; availability was checked once, trademark was not). Then set `NEXT_PUBLIC_APP_URL` to it. For the clinic setup script: `VERCEL_TOKEN` and `VERCEL_PROJECT_ID` (or paste the generated `.vercel.env` yourself).
6. **Supabase access token** (`sbp_...`, Account → Access Tokens) for `pnpm clinic:setup` on each clinic.
7. Values for `OPERATOR_ALERT_EMAIL`, `SHADOW_TEST_EMAIL`, `SHADOW_TEST_PHONE` (where alerts and shadow-mode messages go).

**Business / compliance (guide §16):** DPA signed with each clinic, DPIA, privacy notice text, ICO registration check, retention policy; the first pilot clinic and a shadow-week plan.

**Decisions for Donia (small, no rush):**
- Geist Sans is self-hosted instead of Google Fonts. Tell me if you prefer Google Fonts.
- Each clinic must paste its own privacy notice link in Settings. Until then `/join` shows a short "ask the practice" line instead.

- Migration 0006 (monthly_reports) was applied to the dev database on 2026-11-07 (Donia asked; table, RLS, 3 policies and trigger checked). Dev now has migrations 0001–0009. Open `/reports` to try it. Real clinics still need `pnpm clinic:migrate-all`.

**Heads-ups:**
- A waitlist patient's "notice needed" defaults to 48 h (guide §6.2), so a slot less than 48 h away is offered only to patients who chose a shorter notice.
- An offer SMS with a full-length link can be longer than 160 characters (the link has a UUID); the SMS link is shortened as `/c/<token>`, and the guide says 160 "where possible".
- The offer link uses `NEXT_PUBLIC_APP_URL`. If `pnpm dev` runs on another port (e.g. 3004), set it to that port in `.env.local`.
- Health alert for SMS failures needs at least 5 texts in the hour before it can fire (my choice, to avoid false alarms).
- Guide §14 says the `--fast` simulation shrinks the offer expiry to 1 minute, but the database only allows 5 minutes or more. `--fast` instead ages the offer past its expiry and runs the same tick the cron runs.
- New in this phase and not in the original guide text: migrations `0004_rate_limits` (the "small table" that §15 allows), START keyword, `lib/waitlist-sync.ts` (pure helper only; the optional `/api/v1/waitlist` route is not built).

## Assumptions to confirm (Dentally) — all isolated in `lib/dentally/client.ts` and `normalise.ts`

Endpoints `/v1/appointments|patients|practitioners|treatments`; list responses wrapped as `{appointments:[…]}`; paging `page` / `per_page`; filter `updated_at_gteq`; appointment fields `start_time|start`, `finish_time|end`, `state|status` (contains "cancel") or `cancelled:true`, `reason`, `practitioner_id`, `patient_id`; webhook event name containing "appointment" plus created / updated / deleted. If any of this is wrong only those two files change.

Also not tested live: the Supabase Management API calls in `scripts/lib/api-clients.mjs` (endpoints and auth config field names follow Supabase's documented API; SMTP field names are from memory), and the Vercel env push (endpoint confirmed in Vercel docs).

## Supabase project (no secrets here)

- Name `cancellation-recovery-standalone`, ref `lxdwrmmcmfenxlyemeqp`, region eu-west-2 (London).
- Migrations applied: `schema`, `rls`, `v21_schema_changes` and `rate_limits` (0004, 2026-10-27) and `source_qr_privacy_notice` (0005, 2026-10-27). Extensions `pg_cron` and `pg_net` were enabled while testing the cron SQL; no jobs are scheduled.
- Leftover from that test: two throw-away Vault secrets named `cron_secret` and `app_url` (dummy values, harmless; the database tool refused to delete them). `pnpm clinic:setup` overwrites them with the real values.
- Data: one clinic, **Smile Dentals** (`smile-dentals`), Donia as owner. Waitlist, cancellations and pipelines are empty. The simulation deletes its own test clinic each time (checked).
- `.env.local` (cloud copy) holds the Supabase URL and keys and `CRON_SECRET`. The Mac copy keeps Donia's own.

## Session log

| Date | Built | Tests | Left |
| --- | --- | --- | --- |
| 2026-11-07 (30-day scrub of opted-out waitlist rows) | Migration `0009_scrub_opted_out_waitlist` (`waitlist.scrubbed_at`, `purge_log.waitlist_scrubbed`, `private.scrub_opted_out_waitlist()`); pg_cron job `chairfill-waitlist-scrub` (daily 03:20 UTC) in `CRON_JOBS`; `clinic:setup` and `clinic:migrate-all` warn if a database job is not scheduled (`verifyJobsScheduled`). Keeps phone + `sms_opt_out` + `sms_opt_out_at` as the suppression record. Only INACTIVE opted-out rows are scrubbed (an active, email-reachable one is never touched); scrubbed rows cannot be switched back on (CRM message `SCRUBBED_PATIENT_NOTE`, trigger `trg_waitlist_block_scrubbed_reactivation`); public sign-up on a scrubbed number inserts a new row that inherits the opt-out; `answerSmsPreference` yes and START clear the opt-out on every row of the number (START leaves scrubbed rows inactive, reply `startScrubbedSms`). Docs: CLAUDE.md, HOW_IT_WORKS, README | typecheck clean; 641 tests pass; local RLS_ALL_OK incl. scrub assertions (old inactive row scrubbed, active+email/young/START/no-phone rows untouched, second run 0, anon/authenticated blocked, scrubbed row cannot be re-activated); nothing run on any live DB | `0009` and the job `chairfill-waitlist-scrub` (`20 3 * * *`) applied by Donia on the dev Supabase project (SQL Editor) and checked on 2026-11-07; real clinics still need `clinic:migrate-all`. Not committed |
| 2026-11-06 (STOP follows the phone number) | `lib/sms-suppression.ts`; offers block SMS when any row of the clinic with the same number opted out; `createSmsSender().send()` is a fail-closed last gate for all texts; staff add/edit inherits `sms_opt_out` + date from a matching opted-out row and shows a note (dialog stays open); staff cannot clear the flag (tested); START clears all rows with the number (tested). No migration. Dentally sync is only a planner (not wired), noted in CLAUDE.md | see run at the end of this session | Not committed. Decide the inactive-waitlist retention rule (any scrub must keep phone + opt-out) |
| 2026-11-06 (compliance: audit trail + 30-day purge) | Migration `0007_approval_audit_trail` (`recovery_pipeline.approved_by_name`, `approved_via`; `waitlist_offers.template_version`) and `0008_purge_closed_job_personal_data` (`purge_log`, `private.purge_closed_job_personal_data()`). `lib/template-versions.ts`; `approveBooking` now stores who/when/via for CRM board, Slack and the `/approve` email link; Activity page shows "Approved by X via Y at T". New pg_cron job `chairfill-purge` (daily 03:15 UTC) in the same `CRON_JOBS` list; `clinic:migrate-all` (re)schedules it after the migrations. Docs: CLAUDE.md "Compliance features", HOW_IT_WORKS | typecheck clean; 601 tests pass; local RLS_ALL_OK incl. a purge run on real Postgres (rolled back); build OK; no `lint` script exists | **Apply 0007 + 0008 yourself with `pnpm clinic:migrate-all`** (nothing was run against any live DB), then `select * from cron.job where jobname = 'chairfill-purge';`. Not committed |
| 2026-11-01 (port: reports + clinic admin) | Monthly Reports: migration `0006_monthly_reports` (table + RLS), `lib/reports.ts` (clinic-timezone months, cohort basis, saved/frozen snapshots), `lib/report-pdf.tsx` (server PDF via `@react-pdf/renderer`), `/reports` page + save action + `/reports/pdf`, nav item, proxy protection. Clinic setup: kept our existing (more complete) `clinic:setup`; added `clinic:create`, `clinic:add-manager` and `NEW_CLINIC_SETUP.md`; dropped the n8n/partner key parts. New dependency: `@react-pdf/renderer` | typecheck clean; 586 tests pass; local RLS_ALL_OK (incl. 0006); build OK | **Apply migration 0006 to the live dev DB** (the Supabase tool lost permission); open `/reports` and download a PDF |
| 2026-10-27 (small features) | Patient source: QR code now points to `/join/<slug>?src=qr` and stores `opt_in_source = qr` (label "QR code" in the waitlist). Duplicate warning: adding a manual cancellation for a slot (same time and dentist) already on the board asks "Add anyway" (never blocks). Clinic `privacy_notice_url` (Settings field, https only) shown on `/join` next to consent. Patient who earlier texted STOP and signs up again is asked "text offers again?" (`answerSmsPreference`, rate limited; Yes clears our opt-out, No keeps email only). Migration 0005 applied live | typecheck clean; 557 tests pass; local RLS_ALL_OK; build OK | Live checks with real accounts |
| 2026-10-27 (Phase 6) | Rate limits: migration `0004_rate_limits` (table + `rate_limit_hit()`, service role only) applied live; `lib/rate-limit.ts` on `/join` (20/h), `/confirm` page (120/10 min) and answer (30/10 min), inbound SMS per phone (30/h, silent). Scripts: `clinic-setup.mjs` (9 steps, `--dry-run`, idempotent), `clinic-migrate-all.mjs`, `clinics/clinic.example.env`, pg_cron SQL using Vault (tested on the live DB, then removed), `simulate-flow` (normal + `--fast`). Security checklist §15 reviewed: `pnpm audit` clean, logs carry no patient payloads. Docs: README, CLAUDE.md, HOW_IT_WORKS, this file | typecheck clean; 543 tests pass; local RLS_ALL_OK (incl. 0004); build OK; simulate 7/7 and --fast 7/7 on the live dev DB; local production server smoke test OK | Live checks with real accounts; tick Phases 3–6 afterwards |
| 2026-10-27 (Phases 3c, 4, 5) | 3c: email notifier + templates, Slack approval, `/approve/[token]`, tick cron, real dashboard. 4: Twilio send/status/inbound, SMS templates, STOP/START, `/c/[token]`. 5: Dentally client/normaliser/webhook/poller, doctor import, health monitoring + operator alerts, `waitlist-sync` helper | 418 → 542 tests, all pass | Live checks with real accounts |
| 2026-10-26 (Phase 3b) | Engine: `startOffers`/`offerNext`/`advance`/`giveUp` (`lib/engine/offer.ts`), `respondToOffer`, `approveBooking`/`offerToNext`/`markBooked`/`notifyReception` (`approve.ts`), quiet hours, offer view, notifier interface (`notifier.ts`, `holdNotifier` until 3c). Pages: `/confirm/[token]` (mobile first, noindex, 44 px+ buttons), board buttons (Start offers, Copy offer link, Approve, Offer to next patient, Book in Dentally checklist + Booked ✓). Manual cancellation now starts offers when the engine is on | typecheck clean; 291 tests pass (53 new, incl. an in-memory DB for whole-flow tests); build OK; live browser 22/22 on a temporary clinic | 3c. QA clinic cleanup pending (see Now) |
| 2026-10-26 (Phase 3a) | Pure logic: matching with all hard filters and score rules, offer state + token check, dashboard metrics with rolling ranges and weekly trend buckets. Real clinic Smile Dentals + owner created on the live project for Donia | typecheck clean; 238 tests pass (29 new) | 3b: respondToOffer, advance, startOffers, /confirm, approval |
| 2026-10-26 (login polish) | Show / hide password button (`components/ui/password-input.tsx`) on the login page and both fields of set-password | typecheck clean; 209 tests pass; browser check at 375 px and 1280 px | Phase 3 |
| 2026-10-26 (Phase 2 finish) | Ran the admin-key live checks on a temporary clinic (19 checks, 18 pass; the 19th was a wrong test assumption about manual duplicates): Add cancellation, Close card, `/join` (consent, duplicate phone, honeypot), reception email save, Team role change / remove / transfer ownership. Invite reaches Supabase but a fake address is rejected. Added a server log of the invite error code. Deleted all QA data (database empty). Ticked Phase 2 in the guide | typecheck clean; 209 tests pass; build OK | Phase 3; test a real invite once Brevo SMTP is set |
| 2026-10-26 (naming) | Product named **SlotRefill**. Renamed in the app (browser title, login page, sidebar), `package.json`, README, CLAUDE.md, HOW_IT_WORKS. Guide and Supabase project name left as they are. Working folder is now the Mac folder `Documents/cancellation-recovery-standalone-uk`; `.env.local` created there (secret key to be pasted by Donia) | not re-run on the Mac copy yet (no `node_modules` there); same edits are text only | Phase 2 live checks once the secret key is set |
| 2026-10-26 (Phase 2) | Core logic: `transitionStage`, `ingestCancellation`, pricing, team permissions, time (BST/GMT), waitlist dedupe, QR. Zod schemas for waitlist, public join, settings, manual cancellation, team. Pages: board with real cards + Add cancellation + Close card, waitlist, patient, activity, settings, team, `/join/[slug]`, QR PNG route, print card. New UI: dialog, choice chips, copy field, `Form` (keeps typed values when a server action returns an error; found in the browser test) | typecheck clean; 209 tests pass; build OK; live browser 32/32 on a temporary test clinic (deleted; database empty again) | Live check of admin-client features once the secret key is set; tick Phase 2 |
| 2026-10-26 (Phase 1 finish) | Donia allowed `*.supabase.co`. Ran the real browser login test (16 checks) and the supabase-js RLS script (29 checks) against the live project: all pass. Deleted all QA data (verified empty). Ticked Phase 1 in the guide; updated README, HOW_IT_WORKS | typecheck clean; 130 tests pass; live browser 16/16; live RLS 29/29 | Phase 2 |
| 2026-10-26 (guide v2.1) | Replaced the root guide with v2.1 (diff checked against Donia's list). Added follow-up migration `0003_v21_schema_changes` (offer_expiry_minutes default 30; dropped `booking_mode` and `pms_new_appointment_id`; added `slack_message_ts`) and applied it to the live project. Regenerated-equivalent `lib/database.types.ts` (checked against the live generator output). Reworked the migrations-vs-guide test: 0001/0002 frozen by hash, 0001+0003 must equal guide §5.1, 0003 has exactly the four statements. Added v2.1 column assertions to the local RLS SQL. Updated README, CLAUDE.md, HOW_IT_WORKS, .env.example. Live RLS check passed with read-only queries | typecheck clean; 130 tests pass; local RLS_ALL_OK; build OK | Browser login test (sandbox still gets 403 for `*.supabase.co`), delete QA data, tick Phase 1 |
| 2026-10-26 | Created the Supabase project (London), applied both migrations, wrote `.env.local`, replaced placeholder DB types with generated ones, added `isRole()` because the DB stores role as text | typecheck clean; 126 tests pass | Live RLS check, browser login test, delete QA data, tick Phase 1 |
| 2026-10-17 | Copied guide files; created CLAUDE.md, README.md, PROGRESS.md, HOW_IT_WORKS.md. Phase 1: Next 16 app, §11 tokens, UI components, env validation, Supabase clients, session helpers, proxy, §5 migrations, auth pages, app shell, empty dashboard and board, placeholder CRM pages | typecheck clean; 124 tests pass (9 files, including real RLS on local Postgres and migrations-equal-guide); production build OK | Live login check on a real Supabase project; replace placeholder DB types |

## Notes for the next session

- Sandbox tip: Node ignores the session proxy by default. For live Supabase calls from scripts or `next dev`, set `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`. `*.supabase.co` must stay in Donia's allowed domains.
- Guide v2.1 rule: never edit applied migrations; add a new numbered file (next is `0005`).
- Tests: `pnpm typecheck && pnpm test && pnpm build`; `pnpm simulate` (and `--fast`) for the whole loop on the dev DB. `pnpm test:rls` needs a local PostgreSQL; the script exits 3 ("skipped") if none exists.
- `next dev` regenerates `AGENTS.md`; it is indexed in CLAUDE.md and README.md.
- The build needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` set (any valid-looking values work for a build).
