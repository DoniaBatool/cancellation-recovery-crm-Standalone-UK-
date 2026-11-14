# NEW_CLINIC_SETUP.md — set up a new clinic, step by step

Every clinic gets its **own isolated system**: its own Supabase project, its own Vercel project and its own Brevo account, all on the clinic's card with you as a member. The code is the same for everyone (one repo). Only the clinic file in `clinics/` differs. Reason: guide §13 (one system per clinic keeps patient data separated).

Total time: about one hour, most of it waiting for the clinic's DNS and email verification.

Never commit a clinic file. It holds the Supabase token and the SMTP password. `clinics/*.env` and `clinics/*.vercel.env` are gitignored.

## 1. Accounts (the clinic creates them, you are invited as a member)

| Account | Plan | What you need |
| --- | --- | --- |
| Supabase | Pro, region **London (eu-west-2)**, a new project | You are a member of the organisation |
| Vercel | Pro (business use) | You are a member of the team |
| Brevo | Free (300 emails a day) or Starter | You are a user on the account |

The clinic needs an email address on **its own domain** (for example `appointments@theirclinic.co.uk`). A Gmail or Outlook.com address will land in spam.

## 2. Brevo: verify the clinic's sender

1. Brevo → Senders, Domains & Dedicated IPs → Domains → Add the clinic's domain.
2. Give the SPF, DKIM and DMARC records to whoever manages the clinic's domain. Press Verify.
3. Add the sender address (`appointments@theirclinic.co.uk`) and the clinic name.
4. SMTP & API → SMTP: note the login (`SMTP_USER`) and generate an SMTP key (`SMTP_PASS`).

## 3. Vercel: create the app

1. In the clinic's Vercel team: Add New → Project → import this repo. Name it, for example, `smile-dental-recovery`.
2. The first deploy may fail because the variables are not set yet. That is fine.
3. Note the app URL (`APP_URL`). Optional, to push variables automatically: Project ID, Team ID and a token from vercel.com/account/tokens.

## 4. Supabase: two values

1. Project Settings → General → Project ID (20 letters) → `SUPABASE_PROJECT_REF`.
2. Your own access token (made once, reused for every clinic): Account → Access Tokens → `SUPABASE_ACCESS_TOKEN` (starts with `sbp_`).

Keys, tables, security rules, login settings and cron jobs are all done by the script.

## 5. Fill in the clinic file

```bash
cp clinics/clinic.example.env clinics/<slug>.env
```

Fill in the clinic details, the manager's email and the values from steps 2 to 4. Dentally, Twilio and Slack values can be added later and the script re-run. Leave `CRON_SECRET` and `DENTALLY_WEBHOOK_SECRET` blank: they are generated and saved into the file.

## 6. One command

```bash
pnpm clinic:setup clinics/<slug>.env --dry-run   # checks the file and prints the plan; changes nothing
pnpm clinic:setup clinics/<slug>.env             # does it; safe to run again
```

It reads the Supabase keys, applies every migration, configures Supabase Auth (site URL and the clinic's Brevo as SMTP), creates the clinic and its settings row, invites the practice manager as **owner**, generates the secrets, pushes the variables to Vercel (or writes `clinics/<slug>.vercel.env` to paste), schedules the cron jobs and prints the addresses to paste into Dentally, Twilio and Slack.

If it stops with an error, fix the problem and run the same command again. Nothing already done is repeated.

## 7. Go live

1. Vercel → Deployments → Redeploy, so the new variables apply.
2. The practice manager opens the invite email, chooses a password and signs in.
3. Together, fill in Settings: prices, dentists, reception email, privacy notice link.
4. Copy the sign-up link and print the QR card (Settings → QR card).
5. Paste the printed webhook addresses into Dentally, Twilio and Slack.
6. Run one week in **shadow mode** (messages go to you, not to patients), then switch the engine on and shadow mode off.

## Later

| Task | Command |
| --- | --- |
| A new database change on every clinic | `pnpm clinic:migrate-all` (reads every `clinics/*.env`) |
| Create a clinic row by hand | `pnpm clinic:create --name "..." --email ...` (with `.env.local` pointing at that clinic's Supabase) |
| Add another login to a clinic | `pnpm clinic:add-manager --clinic <slug> --email <email> [--role staff\|admin\|owner] [--with-password]` |
| Code update on every clinic | Push to GitHub; each clinic's Vercel project deploys itself |

Important: `clinic:migrate-all` only reaches databases that have a clinic file. The dev database in `.env.local` is migrated separately (Supabase SQL editor or `supabase db push`). Every new migration, including `monthly_reports`, must reach each clinic. New clinics get all of them through `clinic:setup`.

## Dev email values to replace for a real clinic

On the dev setup (live Brevo check, 2026-11-14) email was tested with Donia's personal Gmail as the sender. Never carry these values to a real clinic. Go through them one by one:

| Setting | Dev value (do NOT reuse) | Real clinic value |
| --- | --- | --- |
| `SMTP_FROM` | Donia's personal Gmail (a free address; Brevo warns that it can land in spam) | A business address on a domain verified in Brevo (SlotRefill business email, or the clinic's own domain) |
| Brevo sender | Gmail verified as a sender | Brevo → Senders, domains, IPs → add and authenticate the domain (DNS records), then add the business sender |
| `SMTP_FROM_NAME` | `SlotRefill` | The clinic name, as patients know it |
| `SMTP_USER` / `SMTP_PASS` | Dev Brevo login and the `slotrefill-dev` SMTP key | The clinic's own Brevo login and a NEW SMTP key (one key per clinic; never share a key between clinics or projects) |
| `OPERATOR_ALERT_EMAIL` | Donia's Gmail | Donia's business email (alerts about the clinic's system) |
| `SHADOW_TEST_EMAIL` | Donia's Gmail | A test address Donia controls, for the shadow week |

Also: do NOT switch on "Activate for SMTP keys" (IP blocking) in Brevo; Vercel's IP addresses change, so it would block our emails. Send one real test email to yourself before going live.

## Checklist (copy for each clinic)

- [ ] Supabase, Vercel and Brevo accounts created, you are a member
- [ ] Brevo domain verified, sender added, SMTP key made
- [ ] Dev email values replaced (see "Dev email values to replace for a real clinic": no Gmail sender, new SMTP key, business `SMTP_FROM`, alert and shadow emails)
- [ ] Vercel project created, app URL noted
- [ ] `clinics/<slug>.env` filled in
- [ ] `pnpm clinic:setup ... --dry-run` is clean, then the real run is clean
- [ ] Redeployed, manager signed in
- [ ] Settings filled in, sign-up link shared, QR card printed
- [ ] Webhooks pasted into Dentally, Twilio, Slack
- [ ] Shadow week done, then engine on
