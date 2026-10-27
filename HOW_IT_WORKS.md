# How Cancellation Recovery works

_Plain-English description for clinics. Updated after each build phase (guide §20). Last updated after Phase 6 (code complete; live checks with real accounts still to do)._

## The idea

When a patient cancels late, the chair sits empty. Reception rarely has time to phone people to fill it. Cancellation Recovery does the chasing and asks reception for one tap to confirm.

This is an **admin tool**. It never gives clinical advice and it does not make clinical decisions.

## The flow

1. A patient cancels, and the system notices.
2. It picks a patient from your waitlist who fits the slot.
3. It offers the slot by SMS and email, with a link to a simple page. The offer is held for 30 minutes by default (you can change this).
4. The patient answers YES or NO once, on any channel. The first answer counts.
5. If YES, reception gets a message in Slack (or sees an amber card in the CRM) and approves it with one tap.
6. The system never writes to your practice system (Dentally). Reception books the slot in Dentally by hand, using a short checklist on the card, and ticks "Booked".
7. If the patient says NO, or does not answer in time, the next patient is offered the slot.
8. The dashboard shows slots recovered, revenue saved, recovery rate and average fill time.

Patients never log in. They only see the sign-up page and the offer page.

## What exists today

The whole loop is built. It has been run end to end against a test database with pretend email and SMS (nothing was sent to anyone). It has **not** yet been run with real Brevo, Twilio, Slack or Dentally accounts: that happens in a one-week shadow period at each clinic, where every message goes to us instead of to patients.

| Part | Status |
| --- | --- |
| Sign in, forgot password, team invites and roles | Built; sign-in tried in a browser against the live project |
| Each clinic only ever sees its own records | Built and checked by automated tests |
| Waitlist, patient page, activity timeline, settings, sign-up link, QR card, public sign-up page | Built and tried in a browser |
| Offers by email and SMS, one answer only, the next patient if NO or no answer | Built and tested with pretend messages |
| Reception approval: one tap in Slack, an email link, or the board | Built and tested with pretend messages |
| Confirmation emails to the patient, the dentist and reception | Built and tested with pretend messages |
| Quiet hours (no texts overnight), approval reminder, expiry, self-healing if something gets stuck | Built and tested |
| Replies by text: YES, NO, STOP (and START to come back) | Built and tested |
| Reading cancellations from Dentally (read-only; never writes to Dentally) | Built from our best understanding of the Dentally API; to be confirmed in a Dentally test account |
| Dashboard: revenue saved, slots recovered, recovery rate, average fill time, weekly trend | Built |
| Alerts to us if something stops working (webhook silent, polling failing, SMS failing, offers stuck) | Built and tested |
| Protection against abuse of the public pages | Built |
| Setting up a new clinic from one settings file | Built and tested; not yet run on a real new clinic |

## The five stages on the board

| Stage | Meaning |
| --- | --- |
| Detected | A cancellation has come in |
| Offer sent | A waitlist patient has been offered the slot |
| Awaiting approval | The patient said YES; reception needs to approve |
| Recovered | The slot is filled |
| Expired / manual | Nobody could take it, so reception may want to fill it by hand |

## Privacy basics

- Each clinic's data is separate; staff only see their own clinic.
- Patients only see their own offer page, reached through a private link.
- Nothing secret (keys, passwords) is stored in the code.
