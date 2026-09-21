# User journeys

Each journey below is implemented end to end and covered by the test suite.
Screen names match the built product.

---

## J1 — A manager issues a week of work

**Suresh Menon, Operations Manager, Friday afternoon**

1. Opens **Work assignments** in the admin portal and clicks *Assign work*.
2. Picks the project. The assignee list narrows to **active members of that
   project only** — nobody else can be selected, and the API refuses it even if
   the request is forged.
3. Enters the task, due date, estimated hours, site and instructions.
4. Ticks *Repeat on every working day until…* and sets Friday next week.
   Six assignments are created, one per working day, each acknowledged
   separately.
5. Each employee is notified immediately.

**Guarantees**: the project must be `active` or `on_hold`; every assignee must
be a current project member; the whole batch is one transaction.

---

## J2 — A field engineer starts their day

**Arun Prakash, Senior Field Engineer, 8:45 am on site**

1. Opens the app. It launches from cache even with no signal.
2. Taps **Check in**. If he has consented to location sharing, his position is
   captured *once*; if not, attendance is recorded with no coordinates at all.
3. The home screen shows a banner: *2 assignments need your acknowledgement*,
   with the wording "Acknowledging confirms you have received and read the
   work. It does not mark it complete."
4. Taps **Review and acknowledge** → a confirmation sheet lists exactly what is
   about to be acknowledged, the total planned hours, and flags anything that
   **changed since he last acknowledged it**.
5. Confirms. Each assignment is recorded individually against its own version,
   tagged `bulk_daily`, with his device label.

**Guarantee**: nothing is acknowledged until he confirms, and no assignment is
marked complete by this action.

---

## J3 — Doing the work

1. Opens the assignment. If it is not acknowledged, the timer will not start —
   the API returns `ACKNOWLEDGEMENT_REQUIRED`.
2. Taps **Start work**. A time entry opens; the assignment moves to *In progress*.
3. Interruption (waiting on a permit) → **Pause**. The segment closes. Elapsed
   time is the sum of closed segments, so a forgotten pause cannot inflate hours.
4. Updates progress to 60% with a note.
5. Finishes → **Mark done**, adds a completion note. Any running timer stops
   automatically and the status becomes *Awaiting review*.

**Guarantee**: exactly one timer per employee, enforced by a partial unique
index in the database, not by the interface.

---

## J4 — The manager reviews, and verifies the hours

1. The submitted assignment appears in the manager's list as *Awaiting review*.
2. **Accept** → the work is marked complete, and the employee is notified.
   **Return** → a comment is mandatory, and the employee is asked for
   clarification.
3. Separately, under **Productivity → Time awaiting verification**, the manager
   selects the recorded entries and verifies them.

**This is the moment recorded time becomes productive time.** Nothing else
produces the figure. A manager cannot verify their own entries.

---

## J5 — Submitting a purchase bill

**Arun buys replacement contactors, ₹4,250.75**

1. Taps **+ Add** on the Expenses tab, picks *Purchase Bills*.
2. **Take photo** opens the rear camera directly. The preview is shown before
   anything is sent.
3. Enters amount, project, vendor and invoice number. The form shows the
   category's limits inline.
4. Taps **Submit claim**. The button is disabled until the claim is valid, and
   the bar above it says exactly what is missing.

**What the server checks, regardless of the interface**: amount above zero;
date not in the future and inside the back-dating window; the employee is a
member of the selected project; per-claim and per-day category limits; a
receipt where the category requires one; file *magic bytes*, not the declared
content type.

**If it looks like a duplicate** — same employee, date, amount and vendor — the
submission is refused with `POSSIBLE_DUPLICATE` and the app asks him to confirm
it is genuinely a second expense before resubmitting.

---

## J6 — Approval, correction and settlement

1. The claim lands in the project manager's **Approval queue**, oldest first.
2. The manager can approve, reject (reason required) or return it (reason
   required). Nobody can decide on their own claim, and finance cannot jump
   ahead of the manager stage.
3. **Returned** → Arun sees *Tap to correct and resubmit*, fixes the invoice
   number and resubmits. The original submission and the return comment are
   both retained; the trail reads `submitted → returned → resubmitted`.
4. Manager approves → the claim moves to finance.
5. Finance approves → **Approved**. The claim is now locked to the employee.
6. Finance selects approved claims and records a reimbursement batch.
   A claim can be paid exactly once, enforced by a unique index.

---

## J7 — The weekly review

**Kavitha Rao, Finance Manager, Monday morning**

1. **Dashboard** — scoped to what she may see: pending approvals, their value,
   spend this month, approval turnaround.
2. **Reports → Expense by project**, exports CSV for the accounting system.
3. Cross-checks with **Expense by employee** — the totals reconcile exactly,
   because both are groupings of the same underlying rows.
4. Every figure carries its definition; the definitions panel is on the page.

---

## J8 — Onboarding a new field engineer

1. Super Admin → **Employees → Add employee**. Role, department, reporting
   manager, base location.
2. A one-time password is displayed **once** and must be shared securely.
3. The employee signs in on their phone, is forced to change the password
   before continuing, and every other device is signed out.
4. Until they are added to a project, they cannot be assigned work or submit a
   claim against it — by design.

---

## Error and edge states

Every journey above has its unhappy paths built, not just described:

| Situation | What the person sees |
|---|---|
| Offline | A banner, cached data, and "This will be sent once you have a signal" |
| Session expired | One silent refresh attempt, then a clear re-sign-in prompt |
| Assignment changed after acknowledgement | An amber warning on the card and in the detail screen |
| Claim over the daily limit | The exact figures: already claimed, this claim, the limit |
| Approving someone else's project's claim | Refused, with the reason stated |
| Deactivating staff with open work | Refused, naming the number of open assignments |
