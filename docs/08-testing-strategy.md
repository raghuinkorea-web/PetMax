# Testing strategy

**58 automated tests, all passing.** They run against a real PostgreSQL
database through the real Express application — no mocked repositories, because
a mocked repository cannot catch a unique index that was never created or a
transaction that rolls back the thing it was supposed to commit.

```bash
npm test          # the whole suite
```

---

## What is tested, and why those things

The suite targets the rules that would cost ADISYS money or trust if they
silently broke. Coverage percentage is not the goal; the goal is that each of
these statements is checked by a test that fails when the statement stops
being true.

### `auth.test.ts` — 8 tests

| Test | The rule it protects |
|---|---|
| Sign in by ID, email or mobile | Field staff remember their ADISYS ID, not an email |
| Unknown user and wrong password are indistinguishable | The endpoint cannot be used to enumerate staff |
| Lockout after repeated failures, every attempt recorded | Credential stuffing is slowed and visible |
| No token / bad token / revoked session are all refused | A valid JWT is not authorisation on its own |
| A deactivated account is blocked mid-session | Deactivation is immediate, not at token expiry |
| Refresh rotates; replaying a retired token kills the family | Token theft is contained |
| Password policy; changing it signs out other devices | A recovered account does not stay compromised |
| Forgot-password answers identically either way | No enumeration through recovery |

### `rbac.test.ts` — 9 tests

Administration endpoints refused to employees; the directory scoped to the
caller; **404 rather than 403** for out-of-scope records; projects hidden from
non-members; a manager blocked from assigning on a project they do not manage;
work refused to non-members; per-user allow and deny overrides applied, with
deny winning.

### `work.test.ts` — 12 tests

| Test | The rule it protects |
|---|---|
| Work cannot be started before acknowledgement | An engineer cannot claim they were never told |
| **Acknowledgement never completes the work** | The single most important rule in the product |
| Only the assignee acknowledges | |
| A material edit invalidates the acknowledgement and bumps the version | Changed scope must be re-confirmed |
| The earlier acknowledgement is retained, not overwritten | The history is evidence |
| Re-acknowledging a changed assignment preserves progress | Confirming a change must not rewind work |
| **Bulk day acknowledgement completes nothing** | Asserted on the stored status of every row |
| Re-running bulk finds nothing left | Idempotent |
| Invalid transitions refused | The state machine is real |
| Only the manager accepts completion; returning requires a reason | |
| Every transition writes an immutable event | |
| A repeat series creates one acknowledgeable assignment per working day | |

### `expense.test.ts` — 18 tests

Submission with a receipt routed to the manager first; zero and negative
amounts refused; future dates and stale dates refused; claims against
non-member projects refused; per-claim and **per-day** category limits enforced
across separate claims; duplicate detection with explicit confirmation; receipt
requirement honoured only where configured; auto-approval under a
no-approver policy writing a `system` trail entry.

Then the workflow: nobody approves their own claim; finance cannot jump the
manager stage; approval locks the claim to the employee; a returned claim is
editable and resubmission **preserves the whole trail**
(`submitted → returned → resubmitted`); rejection records its reason; bulk
decisions are independent; a claim can be paid exactly once; another employee
can read neither the claim nor its receipt; an executable disguised as a PNG is
rejected on its magic bytes.

Finally: **employee-wise and project-wise totals reconcile to the paisa** —
the property that makes the finance reports trustworthy.

### `productivity.test.ts` — 11 tests

One timer at a time; starting a timer moves acknowledged work into progress;
no time against someone else's assignment; overlapping entries refused;
backwards and over-aged entries refused.

Then the measures:

| Test | The rule it protects |
|---|---|
| **Only verified time counts as productive** | Recorded-but-unverified reports as 0 productive minutes |
| Nobody verifies their own time — even with the permission granted | |
| Discounted time keeps its record and its reason but stops counting | |
| Attendance is reported separately from recorded and verified | Being on duty is not productivity |
| **Location is never stored without recorded consent** | Verified against the stored row, not the response |
| Every metric the API reports carries its definition | |

---

## How the suite is set up

`tests/globalSetup.ts` drops and recreates `adisys_fieldops_test`, then applies
every migration from `db/migrations/`. The development database is never
touched. `tests/fixtures.ts` seeds a deliberately small, explicit fixture —
four principals, two projects, three categories, two policies — so a failure
points at one rule rather than at a large shared dataset.

Files run serially (`fileParallelism: false`) because they share one database
and drive real workflows through it.

---

## Manual and exploratory checks performed

Beyond the automated suite, the built product was exercised end to end:

- **69 HTTP checks** across two shell scripts covering sign-in for all four
  roles, RBAC scoping, dashboards, the acknowledgement workflow, the full
  expense lifecycle through to reimbursement, policy enforcement, and private
  file access (200 for the owner and finance, **403** for an unrelated
  employee, **401** anonymous).
- Every admin screen and every mobile screen rendered in a real browser at
  1440×950 and 412×915 and inspected.
- Both applications type-check and build clean.

---

## What is not covered, and what that means

Stated plainly so the gaps are known rather than assumed away:

| Gap | Risk | Mitigation |
|---|---|---|
| No component/UI unit tests | A rendering regression could pass CI | Both apps type-check; screens were manually verified; business rules are enforced server-side and are tested |
| No browser end-to-end suite | A broken flow in the client only | The API contract is fully tested; adding Playwright is the obvious next step |
| Notification delivery not tested | Push/email may fail silently | Writes to the outbox *are* tested; the delivery worker is not yet implemented |
| No load or soak testing | Behaviour at scale unknown | Indexes are in place for every hot path; measure before assuming |
| OCR not implemented | Endpoint returns `queued` only | Documented as such; never on the approval path |

---

## Recommended next steps

1. **Playwright end-to-end** for the two critical journeys: bulk acknowledgement
   on mobile, and submit → return → correct → approve → pay on desktop.
2. **CI**: run migrations, the suite, `typecheck` and both builds on every push.
3. **Contract tests** generated from the Zod schemas, so client and server
   cannot drift.
4. **Load testing** the dashboard and report queries against a year of data.
