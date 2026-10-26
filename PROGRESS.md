# PROGRESS.md

_Last updated: 2026-10-26 (Phase 2 done) · Owner: Donia_

## Overall: 29% (2 of 7 phases fully done) — Phase 1 and Phase 2 are done; Phase 3 (offer loop) is next

Percent = finished phases out of the 7 in guide §19. A phase counts as done only when its "done when" is true. Phase 1 (log in, empty dashboard and board, RLS tests pass) and Phase 2 (a receptionist can manage the waitlist and see a manual cancellation on the board) were both verified on 2026-10-26, so guide §22 Phase 1 and Phase 2 are ticked.

| Phase | Build | Status |
| --- | --- | --- |
| 1. Foundation | Next.js app, tokens, UI components, schema + RLS (3 migrations, v2.1), env validation, auth pages, proxy, app shell | ✅ done 2026-10-26 (Supabase live on v2.1; live RLS and browser login verified) |
| 2. CRM core | Waitlist, patient page, settings, team, join + QR, activity, board, manual cancellation | ✅ done 2026-10-26 (live browser checks 32/32 + 19 admin-key checks; 209 unit tests) |
| 3. Offer loop (no PMS) | Matching, email offers, /confirm, approval (Slack one-tap + CRM + email + /approve), confirmations, expiry, dashboard metrics | ⏳ not started |
| 4. SMS | Twilio send/status/inbound, templates, quiet hours, shadow mode | ⏳ not started |
| 5. Dentally | Read-only client (GET only), webhook, normaliser, poller, health monitoring (no API booking) | ⏳ not started |
| 6. Hardening + multi-clinic | clinic-setup script, migrate-all, pg_cron, rate limits, simulate script | ⏳ not started |
| 7. Pilot | Shadow week, then live | ⏳ not started |

### Phase 1 "done when" breakdown

| Part | Status |
| --- | --- |
| Empty dashboard and empty board render, with shell on desktop and mobile | ✅ checked in a browser (375 px and 1280 px, no sideways scroll) |
| RLS tests pass | ✅ local Postgres with simulated Supabase roles (now also checks the v2.1 columns). ✅ Live project (2026-10-26, read-only queries as each QA user): owner A sees only Clinic A (1 clinic, 2 waitlist rows, 0 of clinic B), owner B only Clinic B, the no-clinic user sees nothing, `anon` sees nothing |
| Log in | ✅ real browser test against the live project (16 checks): logged-out redirects, wrong password error, owner A sign-in (clinic name, email, role, empty dashboard, 5-column board), `/login` redirect when signed in, sign out, no-clinic user sent to `/no-access` and blocked from `/crm`, owner B sees only Clinic B. Also 29/29 supabase-js RLS checks (anon, cross-clinic read/insert/update/delete blocked) |

## Now

- Phase 2 is done and ticked in the guide. Waiting for Donia's go-ahead to start Phase 3 (offer loop, no PMS).

### Phase 2 "done when" breakdown ("A receptionist can manage the waitlist and see a manual cancellation on the board")

| Part | Status |
| --- | --- |
| Waitlist add / edit / pause / search / remove | ✅ live browser test on the real project |
| Patient page, Activity (with actor filter), Settings read + price save, QR PNG + print card, board cards in all stages | ✅ live browser test, 32/32 checks |
| Add cancellation (admin client) | ✅ live: card appears with the settings price, history rows written, past-slot note recorded |
| Close card | ✅ live: moves to `expired_manual`, history row by `front_desk`, shown in Activity |
| `/join/[slug]` | ✅ live: unknown clinic 404, no sideways scroll at 375 px, missing consent refused, sign-up saved (`sms_link`), same phone updates the row instead of adding one, honeypot saves nothing |
| Settings: reception email (admin client) | ✅ live: saved and still there after reload |
| Team: role change, remove, transfer ownership | ✅ live (owner becomes Admin, chosen member becomes Owner) |
| Team: invite by email | ⚠️ code path reaches Supabase; a fake `.test` address is rejected (`email_address_invalid`). A real invite email needs a real address and custom SMTP (Brevo, Phase 3). Not tested with a real mailbox |

## Next

1. Phase 3: matching, `startOffers`, email offers, `/confirm`, `respondToOffer`.
2. Phase 3: approval (Slack one-tap + CRM + email), expiry tick, advance, dashboard metrics.
3. Set up Brevo SMTP (also fixes real invite emails) and test one real invite.

## Blocked / needs Donia

- Secret key: done (`SUPABASE_SECRET_KEY` is set in `.env.local`, Mac copy).
- **Question: clinic privacy notice link.** The guide (§9.9) wants a privacy-notice link on `/join`, but there is no column or page for it. Left out for now. Tell me where it should come from (a new clinic field, or a fixed page).
- **Question: STOP then sign up again.** If a patient texted STOP and later signs up again with the consent box ticked, I keep `sms_opt_out` as it is (no texts) and only reactivate the row. Say if you want sign-up to clear the opt-out instead.
- **Later (Phase 6):** rate limit on `/join` (guide §15).
- Decision (small, no rush): Geist Sans is self-hosted from `app/fonts/` instead of `next/font/google`. Tell me if you would rather use Google Fonts.
- The live project has no real clinic or user yet (test clinics and users were created for browser tests and deleted again; database verified empty). The clinic setup script comes in Phase 6.
- Small note: adding the same manual cancellation twice creates two cards (the guide only de-duplicates PMS appointments by id). This is on purpose: two chairs can cancel at the same time. Tell me if you want a warning for an identical slot.
- `/join` stores `opt_in_source = sms_link`. Tell me if you want a separate value for the QR/web link.

## Supabase project (no secrets here)

- The temporary QA data (3 users, 2 clinics, config, waitlist rows) was deleted on 2026-10-26; every table and `auth.users` is empty again.
- Name `cancellation-recovery-standalone`, ref `lxdwrmmcmfenxlyemeqp`, region eu-west-2 (London), account `ummejawwad313@gmail.com`'s org.
- Migrations applied: `schema`, `rls` (guide v2.0 §5.1/§5.2, frozen) and `v21_schema_changes` (20261026092746). Security advisor: one INFO only (`engine_state` has no policies, by design).
- `.env.local` holds: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `CRON_SECRET` (generated) and `SUPABASE_SECRET_KEY` (filled by Donia).
- The other projects in that account (`foodops-erp`) and in the first account (`cancellation-recovery-crm`, partner's) were not touched.

## Session log

| Date | Built | Tests | Left |
| --- | --- | --- | --- |
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
- Guide v2.1 rule: never edit applied migrations; add a new numbered file (next is `0004`).
- Tests: `pnpm typecheck && pnpm test && pnpm build`. `pnpm test:rls` needs a local PostgreSQL; the script exits 3 ("skipped") if none exists.
- `next dev` regenerates `AGENTS.md`; it is indexed in CLAUDE.md and README.md.
- The build needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` set (any valid-looking values work for a build).
