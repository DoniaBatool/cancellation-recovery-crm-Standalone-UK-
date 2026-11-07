# DATA_RETENTION_STATUS.md

## 1. Purpose

One place to see which patient-data retention and scrub jobs exist, which are still open, and who decides.
Before adding or changing any scrub, read this file and update it.

Last checked against the repo: 2026-11-07 (migrations `0001`–`0009`, `scripts/lib/clinic-env.mjs`).
"DONE" means built and tested **in the repo**. It does not mean applied to a live database: see the note at the end of section 2.

## 2. Waitlist patient states

| State | What it means | Status | What happens to the data | Where it lives (migration or function name) |
| --- | --- | --- | --- | --- |
| Active | Still on the waitlist (`is_active = true`, not opted out). The clinic wants to contact them. | Not scrubbed, by design | Nothing. The data is needed to match and contact the patient. | n/a |
| Opted out (STOP) | The patient replied STOP (`sms_opt_out = true`). STOP also sets `is_active = false`. | **DONE** (in the repo) | Only rows that are **still inactive** (`is_active = false`), 30 days after `sms_opt_out_at`: name becomes `'Opted out'`; email, notes, Dentally id become NULL; preference lists become empty; `existing_patient` becomes false; `scrubbed_at` is set. **Kept as the opt-out suppression record:** `phone`, `sms_opt_out`, `sms_opt_out_at`, `clinic_id`, row `id`. Never deleted. Runs once per row. A row where the patient replied START (`sms_opt_out = false`) is never scrubbed. An opted-out row that is **active again** (patient signed up again for email, or staff switched it on) is never scrubbed. A scrubbed row cannot be switched back on (CRM message + DB trigger); a new sign-up or staff re-add creates a new row that inherits the opt-out. | Migration `20270101000009_scrub_opted_out_waitlist.sql`; function `private.scrub_opted_out_waitlist()`; trigger `trg_waitlist_block_scrubbed_reactivation`; pg_cron job `chairfill-waitlist-scrub`, daily 03:20 UTC (in `CRON_JOBS`, `scripts/lib/clinic-env.mjs`) |
| Booked (offer accepted, patient got the slot) | The patient said YES and the slot was recovered. | **OPEN**. No scrub yet. | Nothing is scrubbed. The waitlist row keeps all its data. | None |
| Removed by staff, or no reply | Staff switched the patient to inactive, or the patient never answered offers. | **OPEN**. No scrub yet. | Nothing is scrubbed. The waitlist row keeps all its data. | None |

For the two OPEN states: Decide with the first real clinic: after how many days of being inactive to scrub (for example 30 or 90). The waitlist belongs to the clinic, so the clinic's retention wish decides. ChairFill follows it. Build the same way as the opted-out scrub: scrub, never delete, idempotent, cron, tests.

Notes on what the repo really does (checked 2026-11-07):
- **"Booked" and "no reply" are not states of the waitlist row.** Nothing in `lib/engine/` sets `waitlist.is_active = false` when an offer is accepted or ignored; the patient stays active. "Booked" only shows as `waitlist_offers.response = 'accepted'` and `recovery_pipeline.waitlist_patient_id` + `stage = 'slot_recovered'`. "No reply" only shows as `waitlist_offers.response = 'expired'`. When the scrub for these states is built, the rule for "inactive" has to be defined first (see checklist).
- **"Removed by staff"** is `is_active = false`, set by the staff active/inactive toggle (`app/(app)/crm/waitlist/actions.ts`). A STOP reply also sets `is_active = false`, and START sets it back to true (`lib/engine/inbound-sms.ts`).
- The opted-out scrub keeps `added_by` (a staff label, not patient data) and `last_contacted_at`.
- **Applied on the dev Supabase project only (2026-11-07):** migration `0009` and the job `chairfill-waitlist-scrub` were run and checked there. Every real clinic project still needs them (`pnpm clinic:migrate-all`), so the opted-out row above is DONE for dev, not yet for clinics.

## 3. Other personal-data stores

| Table / column | Holds | Status | After how long, by which function |
| --- | --- | --- | --- |
| `cancellation_events.cancelled_patient_name`, `cancelled_patient_email`, `cancelled_patient_phone`, `cancellation_reason`, `raw_payload` | The cancelling patient's details and the original webhook JSON | Scrubbed (set to NULL) | 30 days after the slot, or 30 days after the job closed (`slot_recovered` / `expired_manual`). `private.purge_closed_job_personal_data()` (migration `0008`), job `chairfill-purge`, daily 03:15 UTC |
| `recovery_pipeline_history.note` | Free-text history notes (can hold names) | Scrubbed (set to NULL) | Same rule and function as above |
| `messages.body`, `messages.to_or_from` | Message text and the phone number or email it went to | Scrubbed (set to `'[removed]'`) | For finished jobs: same rule and function as above. Messages linked to no job: 30 days after `created_at`. `channel`, `direction`, `status`, `provider_id`, `created_at` are kept on purpose. |
| `recovery_pipeline.notes` | Staff-typed reason when a card is closed (up to 300 characters) | **OPEN**. Not scrubbed. | Needs an UPDATE of `recovery_pipeline`, which the purge avoids (the `set_updated_at` trigger would change `updated_at`). Staff are told not to type patient names there. |
| `waitlist` (all states except opted out) | Name, email, phone, notes, preferences, Dentally id | **OPEN** | See section 2 |
| `waitlist.added_by` | Staff login label (not patient data) | Not scrubbed, not needed | n/a |
| `waitlist_offers` (`offer_token`, ids, `response`, times) | Which patient was offered which slot; the token is the patient's link credential | **OPEN**. Not scrubbed. | No name or phone in the row, but it points at the waitlist row. For opted-out patients that row is scrubbed after 30 days. |
| `messages.waitlist_patient_id`, `recovery_pipeline.waitlist_patient_id` | Links to the waitlist row | Not scrubbed | Ids only. Pseudonymous once the waitlist row is scrubbed. |
| `recovery_pipeline` (approval fields: `approved_by_name`, `approved_via`) | Which staff member approved | Not scrubbed | Staff data, not patient data. Kept as the approval audit trail (DPA 5.6). |
| `monthly_reports.data` | Saved monthly report snapshot (derived numbers) | Not scrubbed | `lib/reports.ts` does not read patient names, phones or emails. Re-check if the report content changes. |
| `engine_state.value` | Poll times, failure counters | Not scrubbed | No patient data expected. |
| `rate_limits.key` | Hashed IP address + counters (`join:<hashed ip>`) | **OPEN**. Not scrubbed. | No clean-up job exists for old rows. Hashed, but not covered by any retention rule. Check before the DPA is signed. |
| `purge_log` | Counts per purge/scrub run | Not scrubbed | No patient data. |
| `clinics.contact_phone`, `clinic_users` | The clinic's own contact and staff logins | Not scrubbed | Clinic and staff data, not patient data. |
| Outside the database (Twilio, email provider, Slack) | Copies of messages and notifications | **OPEN** | Not controlled by ChairFill code. Covered by each provider's own retention and the DPA sub-processor list. |

## 4. Rules that must never be broken

- Scrub, never delete rows.
- Never touch phone, sms_opt_out or sms_opt_out_at on opted-out rows.
- Only patient-driven code paths may set sms_opt_out to false (START reply, or sign-up yes).
- A scrub must never make an opted-out patient receivable again.

## 5. When the first real clinic arrives

- [ ] Agree the retention days with the clinic.
- [ ] Build the scrub for Booked and for Removed/no-reply.
- [ ] Confirm pg_cron is on in that clinic's Supabase project.
- [ ] Add one line to the DPA and privacy notice: "For patients who opt out of SMS, we keep only the phone number, as a suppression record, so they are not texted again."
- [ ] Run the tests.

## 6. Change log

- 2026-11-07: Opted-out scrub now applies only to inactive rows (`is_active = false`); scrubbed rows cannot be switched back on (CRM guard + trigger); sign-up on a scrubbed number creates a new row; "yes" and START clear the opt-out on every row of the number. All inside `0009` (not applied live yet).
- 2026-11-07: File created. Opted-out scrub (`0009`) recorded as DONE in the repo; Booked and Removed/no-reply recorded as OPEN.
