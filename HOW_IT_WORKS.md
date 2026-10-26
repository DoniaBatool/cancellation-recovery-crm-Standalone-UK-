# How SlotRefill works

_Plain-English description for clinics. Updated after each build phase (guide §20). Last updated after Phase 2 (CRM core)._

## The idea

When a patient cancels late, the chair sits empty. Reception rarely has time to phone people to fill it. SlotRefill does the chasing and asks reception for one tap to confirm.

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

## What exists today (after Phase 2)

Phases 1 and 2 build the foundation and the clinic's own tools. Offers, replies and approval are built in later phases (see `PROGRESS.md`).

| Part | Status |
| --- | --- |
| Sign in, forgot password, set password | Built and tried in a browser against the live project (sign in, sign out, no-clinic page) |
| Clinic data kept separate: each clinic only ever sees its own records | Built and checked by automated tests on a local database |
| Dashboard (empty, with the four headline tiles) | Built |
| Pipeline board with its five columns (empty) | Built |
| Waitlist: add, edit, pause, search, remove permanently | Built |
| Patient page (details, offer history, messages) | Built |
| Activity: a timeline of everything that happened to each slot | Built |
| Settings: reception email, prices, dentists, how offers are sent | Built |
| Sign-up link, QR code and a printable card for reception | Built |
| Public sign-up page for patients (with consent box) | Built |
| Team: invite, change role, remove, hand over ownership | Built |
| Add a cancellation by hand and see it on the board | Built; the live check waits for the server key |
| Offers, SMS, email, approval, Dentally | Not built yet (Phases 3 to 5) |

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
