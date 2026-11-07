# CLAUDE.md — rules and file index for Claude

Project: **Cancellation Recovery — Standalone Build** (CRM + engine for UK private dental clinics).
Owner: Donia. Private. Not for a public repo.

## 1. Source of truth

- `SYSTEM_BUILD_GUIDE.md` is the single source of truth. Read it before any work.
- Never contradict it. If something must change, tell Donia first and wait for a decision.
- Follow its stack (§3.2), conventions (§3.3), folder structure (§3.4), SQL (§5), rules (§6), engine modules (§7), pages (§9), design tokens (§11) and phases (§19).
- Build **one phase at a time**. Tick the §22 checklist in the guide only after a phase's "done when" is true.

## 2. Session routine

1. **Start of every session:** load `/project-workflow`, read `PROGRESS.md`, then tell Donia in 3–4 lines where we are and what is next.
   - Also remind Donia of the "Open items to remind Donia about" list in `PROGRESS.md` (one line each) until she confirms an item is done.
2. **End of every step:** update `PROGRESS.md` before saying the step is done.
3. **Never commit or push** unless Donia asks. Suggest a short commit message when a step finishes.
   - **Whenever you give Donia a `git commit` command, give the `git push` command together with it in the same message** (one copy-paste block). She runs both herself; you still never run them unless she asks.
4. If a requirement is unclear, ask **one short question** instead of guessing.

## DONIA'S WORKING STYLE — follow these rules always

| # | Rule |
| --- | --- |
| 1 | `/project-workflow` at the start of every session and before any new feature or tech decision. |
| 2 | `/ui-ux-pro-max` and `/shadcn-ui-blocks` before building or changing any page, component or layout. Keep the guide's §11 colours and tokens. |
| 3 | `/auto-eval` after every code change: write or update tests, run the full suite, report the result. |
| 4 | `/crm-partner-api-route` only if we build the optional external API (guide §8.4). Adapt it: no n8n, key = `EXTERNAL_API_KEY`. |
| 5 | If the same multi-step task repeats 2–3 times, propose a new skill with `/skill-creator` and explain why. |
| 6 | Update `README.md` after every significant feature, fix or architecture change. |
| 7 | Every new document file gets a row in the file table below **and** in the README "Docs index". |

Note on the UI rule: the generic project-workflow skill lists seven UI skills. For this project Donia's project instructions are the rule: `/ui-ux-pro-max` + `/shadcn-ui-blocks`, constrained by guide §11 (calm, clinical, no gradients, navy + blue).

## 3. Build rules

- Do not add libraries or change the stack without asking Donia.
- **Never put secrets** (API keys, passwords, tokens) in code, commits or chat. Use `.env.local` only (gitignored). Keep `.env.example` updated, with no values.
- Do not invent statistics, prices or claims. Admin features only, never clinical advice.
- Language: explain things to Donia in simple **Roman Urdu**. Code, comments and documents stay in **English**.
- Every stage change goes through `transitionStage()` (guide §6.1). Zod at every edge. Two Supabase clients (server/RLS and admin). Send functions never throw. Pure logic in `lib/` with tests. Times in UTC, shown in `Europe/London`. Money as whole pounds.

## 4. Compliance features (DPA UK GDPR Art. 28)

Three features back promises in the DPA. Do not weaken them without telling Donia.

**Approval audit trail (DPA 5.6: "every patient message ties back to a logged approval: who approved, when, through which channel, and which version of the offer text was sent")**
- Columns (migration `0007`): `recovery_pipeline.approved_at` (existing), `approved_by` (existing; CRM login UUID, NULL for Slack), `approved_by_name` (new), `approved_via` (new: `portal` | `slack` | `email` | `other`), and `waitlist_offers.template_version` (new).
- Set in one place: `approveBooking()` in `lib/engine/approve.ts` (`approvalViaOf(actor)`). Callers: the CRM board and the `/approve/<token>` email page both go through `approvePipeline` in `app/(app)/crm/actions.ts` (the email page sends a hidden `via=email`, validated by `pipelineTargetSchema`; default is `portal`); Slack goes through `lib/engine/slack-actions.ts` (name from the Slack payload, `approved_by` stays NULL). `other` is reserved for future paths (e.g. the optional external API).
- `template_version` is set when `lib/engine/offer.ts` creates the offer rows, from the constants in `lib/template-versions.ts` (`offer-email-v1`, `offer-sms-v1`; joined with a comma when both channels are used). **Bump the constant whenever the wording in `lib/email-templates.ts` or `lib/sms-templates.ts` changes.**
- Shown on the Activity page as "Approved by X via Y at T" (read from the card, so it survives the purge).

**30-day purge (DPA 8.1: personal data of closed jobs removed after 30 days)**
- `private.purge_closed_job_personal_data(retention default '30 days')` (migration `0008`), SECURITY DEFINER, executable by the database owner only. Each run writes one row to `public.purge_log` (RLS on, no policies).
- Finished job = a `cancellation_events` row whose `slot_datetime` is older than the retention, OR whose pipeline is in `slot_recovered`/`expired_manual` with `COALESCE(confirmed_at, expired_at, updated_at)` older than the retention.
- It SCRUBS, never deletes: `cancellation_events` name/email/phone/reason/raw_payload → NULL; `recovery_pipeline_history.note` → NULL; `messages.body` and `messages.to_or_from` → `'[removed]'` for those jobs, plus messages linked to no job once older than the retention.
- Why `'[removed]'` and not NULL: `body` and `to_or_from` are NOT NULL. `channel`, `direction`, `status`, `provider_id`, `created_at` are deliberately kept: `lib/engine/health.ts` (SMS failure rate) and `handleSmsStatus` (Twilio delivery reports) read them. STOP/START needs nothing from `messages`: opt-out lives in `waitlist.sms_opt_out`.
- It NEVER touches: `public.waitlist`; any UPDATE of `recovery_pipeline` (the `set_updated_at` trigger would bump `updated_at`); dates, stage, revenue, `procedure_type` (monthly reports and `monthly_reports` snapshots stay identical). A test (`tests/migrations.test.ts`) fails if the migration gains a DELETE, an UPDATE of `recovery_pipeline`, or a `waitlist` reference.
- Known gap: `recovery_pipeline.notes` (the staff-typed reason when a card is closed, up to 300 characters) is NOT scrubbed, because that needs an UPDATE of `recovery_pipeline`. Staff should not type patient names there.
- Schedule: pg_cron job **`chairfill-purge`**, daily **03:15 UTC**, command `select private.purge_closed_job_personal_data()`. It lives in `CRON_JOBS` in `scripts/lib/clinic-env.mjs` (an in-database job: `sql` instead of `path`), so `clinic:setup` schedules it for new clinics and `clinic:migrate-all` re-schedules it by name after the migrations (safe to re-run; dry-run lists it). There is no second scheduling path.
- **Open decision:** waitlist patients with `is_active = false` who did NOT opt out (booked, removed, no reply) are NOT purged. Opted-out rows are handled by the waitlist scrub below. Decide a retention rule for the rest before the DPA is signed with a clinic.

**STOP follows the phone number (SMS suppression)**
- Opt-out lives in `waitlist.sms_opt_out` (+ `sms_opt_out_at`). It is checked by **number**, not by row: if ANY waitlist row of the same clinic has the same number (compared in E.164 via `normalizeUkPhone`) with `sms_opt_out = true`, no SMS goes to that number from any row. Code: `lib/sms-suppression.ts` (`phoneKey`, `findOptOut`, `inheritedOptOut`, `loadOptedOutPhones`).
- Enforced at send time in two places: (1) `lib/engine/offer.ts` marks every candidate whose number opted out as opted out before matching, so no SMS channel is offered; (2) `createSmsSender().send()` in `lib/sms.ts` is the last gate for EVERY text (offers and the booked confirmation): it refuses and writes no message row. If the opt-out list cannot be read, SMS is blocked (fail closed); email is unaffected.
- Staff add/edit (`app/(app)/crm/waitlist/actions.ts`): a patient whose number matches an opted-out row is still created or saved, but the row gets `sms_opt_out = true` and the original `sms_opt_out_at`, and staff see "This patient opted out earlier. They will not get SMS until they reply START." (`smsOptedOutNote` in `FormState`, shown by `patient-form-dialog.tsx`, which stays open until staff close it). The action can only SET the flag, never clear it.
- **No staff button clears `sms_opt_out`, and none must be added.** Only the patient clears it: reply START (`lib/engine/inbound-sms.ts` updates every row with that number) or answer "yes" after signing up again on the public link/QR (`answerSmsPreference` in `app/join/[slug]/actions.ts`, which clears every row of that number). A test fails if any other file under `app/` or `lib/` writes `sms_opt_out: false`.
- Dentally to waitlist sync: `lib/waitlist-sync.ts` is only a planner today; nothing calls it, so no Dentally row is written to `waitlist` yet. **When that sync is wired, its insert must use `inheritedOptOut()` like the staff form.** The send-time gates above already protect a row that slips through.
- The 30-day waitlist scrub (below) keeps `phone`, `sms_opt_out` and `sms_opt_out_at`, or this suppression would stop working. The purge from `0008` never touches `waitlist`.

**30-day scrub of opted-out waitlist rows (DPA 8.1)**
- Before adding or changing any scrub, read and update `DATA_RETENTION_STATUS.md`.
- `private.scrub_opted_out_waitlist(retention default '30 days')` (migration `0009`), SECURITY DEFINER, executable by the database owner only (REVOKE from PUBLIC/anon/authenticated). Each run writes one `purge_log` row; the new counter is `purge_log.waitlist_scrubbed`. New nullable column `waitlist.scrubbed_at` makes it run once per row (idempotent).
- Scope: ONLY rows with `sms_opt_out = true` **and `is_active = false`**, `sms_opt_out_at` older than 30 days, a non-NULL phone, and `scrubbed_at IS NULL`. STOP sets `is_active = false`, so a STOP row is in scope. A row that is **active again** (the patient signed up again for email, or staff switched it on) is still wanted by the clinic and is never scrubbed. A row whose patient replied START (`sms_opt_out = false`) is never scrubbed. Other inactive patients (booked, removed, no reply) are out of scope: no scrub for them.
- SCRUBS, never deletes: `patient_name` -> `'Opted out'`; `email`, `notes`, `pms_patient_id` -> NULL; `preferred_procedures/days/times/doctors` -> empty; `existing_patient` -> false.
- **The phone number is kept ONLY as an opt-out suppression record**, together with `sms_opt_out`, `sms_opt_out_at`, `clinic_id` and the row `id`. It is never used to contact the person; it exists so STOP keeps working by number. Do not scrub or delete these columns.
- Schedule: pg_cron job **`chairfill-waitlist-scrub`**, daily **03:20 UTC**, in `CRON_JOBS` (`scripts/lib/clinic-env.mjs`, `sql` job) beside `chairfill-purge`. `clinic:setup` (step 8) and `clinic:migrate-all` now check `cron.job` afterwards and print a warning ("cron job(s) NOT scheduled ... Enable pg_cron") if a job is missing (`verifyJobsScheduled` in `scripts/lib/clinic-runner.mjs`).
- `updated_at`: the `set_updated_at` trigger on `waitlist` sets it to the scrub time. Nothing reads it for decisions (matching uses `is_active`, preferences and `last_contacted_at`), so it does not matter.
- **A scrubbed row never comes back to life.** It has no name or email, so: (1) `setWaitlistActive` and the staff edit form refuse it with "This patient's data was removed after they opted out. Ask them to sign up again." (`SCRUBBED_PATIENT_NOTE`); (2) a DB trigger (`trg_waitlist_block_scrubbed_reactivation`, `private.block_scrubbed_waitlist_reactivation()`) refuses `is_active` false -> true on a scrubbed row as a backstop; (3) a public sign-up never reuses a scrubbed row, it inserts a NEW row that inherits the opt-out (flag + original date) and asks the SMS question; "yes" (`answerSmsPreference`) now clears the opt-out on every row of the number, including the scrubbed one; (4) a staff re-add is a new row that inherits the opt-out; (5) a START reply still clears `sms_opt_out` on every row of the number but only switches non-scrubbed rows back on; if all rows are scrubbed the reply is `startScrubbedSms` ("sign up again").
- Known edge case: a staff re-add or sign-up that inherits an old `sms_opt_out_at` is an ACTIVE row, so it is not scrubbed. If it is later paused (inactive) it becomes eligible straight away, because the old date is more than 30 days ago.
- Not scrubbed by this job (reported, not changed): `messages` rows (body/`to_or_from`) are cleared by the `0008` purge on their own 30-day clock; `recovery_pipeline.notes` free text; `waitlist_offers.offer_token`/ids (pseudonymous, they point at the scrubbed row).

**Rule: never edit an applied migration.** `0001`–`0009` are applied (or about to be) on live projects. Any schema or function change is a NEW numbered migration. If the purge function itself must change, add a migration with `CREATE OR REPLACE FUNCTION`.

## 5. File index

| File | What it contains | When to use it |
| --- | --- | --- |
| `SYSTEM_BUILD_GUIDE.md` | Complete spec: flow, stack, SQL, domain rules, engine E1–E10, routes, pages, copy, design, phases | Before any work; the single source of truth |
| `whoNext.md` | Which sectors and products to target next, and lead sources | When Donia asks about new targets or products |
| `CLAUDE.md` | These rules and this file index | Start of every session |
| `README.md` | What exists, how to run it, Docs index | When setting up or checking what is built |
| `PROGRESS.md` | Phase table, Now / Next, blocked items, session log | Start and end of every session and step |
| `AGENTS.md` | Auto-generated by `next dev`: Next 16 differs from older versions; read `node_modules/next/dist/docs/` | Don't edit; read before using Next APIs |
| `HOW_IT_WORKS.md` | Plain-English flow for clinics (guide §20 asks us to update it after each phase) | After each phase; when explaining the product to a clinic |
| `.env.example` | Names of all environment variables, no values | When setting up `.env.local` or Vercel env |
| `supabase/migrations/*.sql` | Database schema and RLS from guide §5. `0001`/`0002` are applied to the live project and frozen (a test checks their hash); `0003_v21_schema_changes` holds the v2.1 changes; `0004_rate_limits` is the small rate-limit table (guide §15); `0005_source_qr_privacy_notice` adds the `qr` source and `clinics.privacy_notice_url`; `0006_monthly_reports` adds the saved monthly report snapshots; `0007_approval_audit_trail` adds the approval audit columns; `0008_purge_closed_job_personal_data` adds the 30-day purge function and `purge_log`; `0009_scrub_opted_out_waitlist` adds `waitlist.scrubbed_at` and the opted-out waitlist scrub | When changing the database: add a new numbered migration, never edit an applied one |
| `clinics/clinic.example.env` | Template for one clinic's setup file; filled copies (`clinics/<slug>.env`, `*.vercel.env`) are gitignored and hold secrets | Onboarding a clinic |
| `scripts/clinic-setup.mjs` | `pnpm clinic:setup clinics/<slug>.env [--dry-run]` (guide §13); safe to re-run | Onboarding a clinic |
| `NEW_CLINIC_SETUP.md` | Step-by-step guide to set up a new clinic | Onboarding a clinic |
| `scripts/clinic-admin.mjs` | `pnpm clinic:create` / `pnpm clinic:add-manager` (logic in `scripts/lib/clinic-admin.mjs`) | Adding a clinic row or a login by hand |
| `scripts/clinic-migrate-all.mjs` | `pnpm clinic:migrate-all [--dry-run]`: pending migrations to every clinic file | After adding a migration |
| `scripts/simulate-flow.mjs`, `scripts/simulate/` | `pnpm simulate [--fast]`: whole loop on the dev database with a recording notifier; deletes its own test clinic | After engine changes; before a pilot |
| `scripts/lib/*.mjs`, `*.d.mts` | Unit-tested helpers and steps behind the clinic scripts | When changing the clinic scripts |
| `DATA_RETENTION_STATUS.md` | Which patient-data retention and scrub jobs are done and which are open (waitlist states, other data stores, rules, first-clinic checklist, change log) | Before adding or changing any scrub; when talking to a clinic about retention |
| `lib/sms-suppression.ts` | STOP-by-phone helpers (match in E.164, inherit the flag, load the clinic's opted-out numbers) | When anything decides whether an SMS may be sent, or a waitlist row is created |
| `tests/sql/supabase-stub.sql` | Test-only stand-in for Supabase roles and `auth.uid()` | Only used by `pnpm test:rls` |
| `tests/sql/rls-assertions.sql` | Row-level-security checks run on a local Postgres | When adding tables or policies |
| `scripts/rls-check.sh` | Runs the real migrations on a throwaway Postgres and the RLS checks | `pnpm test:rls`; part of the full test suite |
| `app/fonts/GEIST-LICENSE.txt` | Licence (SIL OFL 1.1) for the self-hosted Geist font | When checking font licensing |
