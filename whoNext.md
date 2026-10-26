# whoNext.md — who to target next, and what to build for them

_Created 2026-10-17 · Owner: Donia · Private. Read this alongside `SYSTEM_BUILD_GUIDE.md` when starting the separate project._

> **Rule of thumb:** sell the **same product** to a **similar customer** first, because there's no new build. Only then build a **new product** for a **new sector**.
>
> Order:
> 1. UK private dental: win 3–5 paying clinics.
> 2. Other UK private clinics: same system, small wording/connector changes.
> 3. Care sector: a new product ("Shift Fill") on the same engine.
>
> Verify any market facts or software APIs before you rely on them. Nothing here is a researched statistic.

---

## 1. Target order (recommended)

| # | Who | Why next | What to sell | Build effort |
| --- | --- | --- | --- | --- |
| 1 | **UK private dental practices** (now) | Paid appointments, so every empty chair = lost money. Many use Dentally. | Cancellation Recovery | Done / in progress |
| 2 | **Aesthetics / skin clinics** | High-value slots, often private, appointment-based | Cancellation Recovery + treatment follow-up | Small: new PMS connector (e.g. Pabau, Phorest) or manual-entry mode |
| 3 | **Physio / chiropractic / osteopathy** | Many short sessions, frequent cancellations | Cancellation Recovery + recall/reactivation | Small: connector (e.g. Cliniko, Jane, WriteUpp) |
| 4 | **Private GP / private paediatrics / independent doctors** | Paid consultations, higher price per slot | Cancellation Recovery + missed-call text-back | Small–medium: connector (e.g. Semble, Heydoc, Cliniko) |
| 5 | **Veterinary practices** | Same no-show problem, not "medical" data | Cancellation Recovery | Small: connector (e.g. Provet Cloud, ezyVet) |
| 6 | **Care homes / home-care agencies** | Big CQC list, real staffing pain | **A new product: Shift Fill** (§3) | Medium: same engine, new screens |

**Not a target:** NHS GP practices (explained in §2).

---

## 2. What is a GP practice?

- A **GP practice** (also called a "surgery" or "medical centre") is the **family doctor** office in the UK.
- People register with their local GP. It's the first place they go for most health problems: check-ups, prescriptions, referrals to hospital specialists.
- Most GP practices are **NHS** practices:
  - patients don't pay per appointment;
  - the practice is paid by the NHS under a contract;
  - they use NHS-approved clinical systems (e.g. EMIS, SystmOne) with strict access rules.

**Why NHS GPs are a weak target for us:**

- A cancelled NHS appointment doesn't lose the practice direct income, so a "revenue saved" pitch doesn't work.
- They're already flooded with demand; the slot gets used anyway.
- Connecting to NHS systems needs NHS assurance processes, which are slow and expensive.
- Buying decisions often involve the practice partners and the local NHS (ICB).

**Private GPs** (paid consultations, e.g. £80–£150+ — verify locally) are a good fit, because a cancelled slot there *is* lost income.

---

## 3. Care homes and home-care agencies — should they be next?

### What they are

| Type | What it is |
| --- | --- |
| **Care home** (residential) | People live there and get help with daily life |
| **Nursing home** | A care home with registered nurses on site |
| **Home-care / domiciliary care agency** | Carers visit people in their own homes (e.g. 30-min visits, several times a day) |

All of these are registered with **CQC** in England, so lead lists are free and complete.

### Is it the right *next* target?

**Not immediately.** Make it the 2nd product after 3–5 dental clients.

**Pros:**

- Huge, well-listed market (CQC directory).
- Many independent owner-run businesses.
- Strong, daily pain: **staff no-shows and unfilled shifts**.

**Cons:**

- Cancellation Recovery doesn't fit them. Residents don't "book slots", so you need a different product.
- Margins are tight and owners are busy and often cautious about tech, so pricing must be lower or clearly pay for itself.
- Data includes vulnerable people. Keep the product about **staff and admin**, not care records, to stay low-risk.

### Systems that fit them perfectly

These reuse the same engine: detect an event → match people → offer by SMS → first YES wins → manager approves → dashboard.

1. **Shift Fill (best fit — build this first)**
   - A carer calls in sick, or a shift is unfilled.
   - The manager adds it (or it comes from the rota software).
   - The system texts suitable bank or off-duty staff: "Shift Tue 07:00–15:00 at Rose House. Reply YES."
   - The first YES goes to the manager, who approves; the rota is updated and everyone else gets "shift filled".
   - Dashboard: shifts filled, hours covered, agency spend avoided. Agency staff cost much more than own staff — get real numbers from the client.
   - **Home-care version:** offer a missed **visit run** to nearby available carers.
2. **Care home enquiry / occupancy CRM:** families looking for a bed fill in a form or call → instant reply → tour booking → follow-ups → pipeline board (enquiry → tour → assessment → move-in). Empty beds are their biggest revenue loss.
3. **Carer recruitment pipeline:** job ad → applicant form → auto-screening questions → interview booking by SMS → document checklist (DBS, right to work, training) → start date. Recruitment is a constant pain in the sector.
4. **Training and compliance reminders:** staff certificates expiring (manual handling, medication, first aid) → reminders to staff and the manager, plus a CQC-ready summary.
5. **Family update messages** (later, careful): approved, non-clinical updates and visit booking for families.

**Rota/care software to check for APIs:** e.g. Birdie, CarePlanner, Access Care Planning, Person Centred Software, Log my Care, Rotacloud, Deputy. Verify which have a public API. Until then, use manual-entry mode.

### Selling notes

- Buyer: registered manager or owner.
- Pitch: "fill shifts without agency staff".
- Pilot: 1 home, 2 weeks, manual-entry mode.

---

## 4. Other systems we can offer UK dentists and doctors

Same building blocks: PMS connector + SMS/email + CRM board + dashboard. Keep everything **admin-only**, never clinical advice.

| # | System | What it does | Best for |
| --- | --- | --- | --- |
| 1 | **Missed-call text-back** | An unanswered call triggers an instant SMS: "Sorry we missed you — book here or reply". Reception sees the replies. | Everyone, quick win |
| 2 | **Treatment-plan follow-up** | High-value plans not accepted (implants, aligners, veneers, whitening) get a polite 2–3 week SMS/email sequence. Replies go to the board. | Private dental, aesthetics |
| 3 | **Recall / reactivation** | Patients overdue for a check-up/hygiene or lapsed for 12+ months → batch campaign + booking link. Dashboard of re-booked revenue. | Dental, physio, optometry |
| 4 | **New-enquiry speed-to-lead** | Website form, Facebook, Instagram or WhatsApp enquiries → instant reply, assigned to reception, with a 15-minute reminder if unanswered. | Private clinics |
| 5 | **Google review requests** | After a completed appointment: "How was your visit?" Happy patients get the Google link; unhappy ones go to the manager. | Everyone |
| 6 | **Appointment confirmations + smart reminders** | "Reply C to confirm, R to reschedule"; non-confirmers flagged to reception. This feeds Cancellation Recovery earlier. | Everyone |
| 7 | **Deposit / no-show protection** | Stripe deposit link for long or high-value appointments; the clinic holds the money. | Dental, aesthetics |
| 8 | **Membership-plan failed-payment chaser** | Practice plan payments that fail → automatic polite follow-up. | Private dental |
| 9 | **Digital pre-visit forms** | Medical history / consent forms by link before the visit, saving reception time. Needs careful data handling. | Dental, aesthetics, private GP |
| 10 | **Practice KPI dashboard** | Cancellations, recoveries, new patients, chair utilisation, revenue per day (read-only from the PMS). | Practice owners |
| 11 | **Staff shift / locum fill** | Same as Shift Fill (§3) for dental nurses, hygienists or locum GPs. | Dental groups, private GP |
| 12 | **After-hours AI receptionist** (chat/voice) | Answers FAQs (prices, opening hours, parking), captures details, books callbacks. **Never clinical advice.** | Private clinics |
| 13 | **Referral tracker** | Specialist practices (orthodontics, implants) track referrals from other dentists, with thank-you and status updates to the referrer. | Specialist dental |
| 14 | **Lab case tracker** | Crowns/aligners sent to the lab, with due dates and reminders before the patient's appointment. | Dental |

**Bundle idea:** **"Front-desk autopilot"** = Cancellation Recovery + Missed-call text-back + Treatment-plan follow-up, for one monthly price.

---

## 5. How to pick each next move

1. Is the customer **private / paid per appointment** (or paying a lot for agency staff)? If no → skip.
2. Can we get the data: a PMS/rota API, webhooks, **or** is manual entry acceptable for a pilot? If no → skip.
3. Can we show **money saved** on a dashboard within 2 weeks? If no → rethink the offer.
4. Is it **admin, not clinical**? If no → don't build it.
5. Is there a free lead list (CQC, LinkedIn, directories)? If yes → good.

---

## 6. Lead sources by target

| Target | Lead source |
| --- | --- |
| Dental, private GP, aesthetics (regulated), physio (some), care homes, home-care (England) | **CQC** directory/API, filtered by service type and location |
| Scotland / Wales / NI | Healthcare Improvement Scotland & Care Inspectorate · HIW & CIW · RQIA |
| Aesthetics, physio, vets | Google Maps, Instagram, trade directories (e.g. RCVS Find a Vet for vets) |
| Decision makers | LinkedIn: practice manager, registered manager, clinic owner, principal dentist |
