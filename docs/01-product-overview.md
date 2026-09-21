# ADISYS FieldOps — product overview

**Observation Driven Insights, applied to field operations.**

ADISYS FieldOps is the system of record for what ADISYS field staff were asked
to do, what they actually did, how long it took, and what it cost.

---

## The problem it solves

ADISYS runs engineering and field-service projects across multiple sites. Four
things routinely go wrong without a single system:

| Problem | What it costs |
|---|---|
| Work is assigned by phone or WhatsApp | Nobody can prove an engineer was told, or when |
| "Productivity" is inferred from login time | Figures nobody trusts, so nobody acts on them |
| Purchase bills arrive as photos in a chat | Weeks of chasing, duplicated claims, no project attribution |
| Spend is reconciled in a spreadsheet | Project profitability is known only after the fact |

FieldOps closes each of these with an auditable record rather than a report
that has to be believed.

---

## The four things the product actually does

### 1. Issue work, and prove it was received

A manager assigns daily or weekly work to a project member. The employee's
phone shows it immediately. They **acknowledge** it — a timestamped record
against the exact *version* of the assignment they were shown.

If the manager later changes the scope, due date or instructions, the
acknowledgement is invalidated automatically and the employee is asked to
confirm the change. Neither side can later claim the other was not told.

> **Acknowledgement is receipt, never completion.** The product says so in the
> interface, the API refuses to conflate them, and the test suite asserts it.

### 2. Record time honestly

Three separate measures, never merged:

| Measure | What it is | Where it comes from |
|---|---|---|
| **On duty** | Time between check-in and check-out | Attendance |
| **Recorded** | Time logged against a specific assignment | Timer or manual entry |
| **Verified** | Recorded time a manager has confirmed | Manager review |

Only **verified** hours are reported as productive. Time logged without an
assignment is reported separately and never counted. Being signed in produces
no productivity figure at all.

### 3. Turn a photograph of a bill into a settled claim

A field engineer photographs a bill, picks the project and category, enters the
amount, and submits — typically under a minute. From there the claim follows a
configured approval route (manager, finance, both, or neither), and every
decision is recorded with its author, timestamp and reason.

A returned claim keeps its entire history through correction and resubmission.
Nothing is overwritten.

### 4. Show what a project is costing, as it happens

Every hour and every rupee is attached to a project. Project-wise and
employee-wise views are two groupings of the *same* rows, so they reconcile
exactly — a property the test suite checks.

---

## Who uses it

| Role | Where | What they do |
|---|---|---|
| **Super Admin** | Admin portal | Configures the organisation, roles, policies; sees everything |
| **Operations / Project Manager** | Admin portal | Runs projects, assigns work, reviews completion, approves expenses at the manager stage, verifies time |
| **Finance / Accounts Manager** | Admin portal | Reviews and settles claims, runs financial reports |
| **Employee / Field Staff** | Android app | Receives and acknowledges work, records time, submits bills |

Access is enforced per request, not per screen. See [07-rbac.md](07-rbac.md).

---

## What the product deliberately does not do

Stating these plainly is part of the design:

- **No continuous location tracking.** Location is captured only at check-in
  and check-out, only with explicit recorded consent, and the employee can
  revoke it at any time. The setting that would enable background tracking is
  rejected by the server's own schema validation.
- **No productivity score.** The product reports hours, completion and
  acknowledgement rates with published definitions. It does not compute an
  opaque number and call it performance.
- **No silent OCR.** Extracted receipt values are always a suggestion the
  employee confirms before submission, and never an approval.
- **No hardcoded approval rules.** Routing lives in `expense_policies` rows.
  Changing ADISYS policy is a configuration change, not a deployment.

---

## Shape of the system

```
                    ┌──────────────────────────┐
  Admin portal ────▶│                          │
  (React, desktop)  │   ADISYS FieldOps API    │◀──── Employee app
                    │   Express · TypeScript   │      (React PWA →
  Reports, CSV ◀────│   RBAC on every request  │       Capacitor APK)
                    └────────────┬─────────────┘
                                 │
                   ┌─────────────┴──────────────┐
                   │        PostgreSQL          │
                   │  37 tables · 7 views       │
                   │  audit log · policy rows   │
                   └────────────────────────────┘
                                 │
                   ┌─────────────┴──────────────┐
                   │   Private object storage   │
                   │  receipts, never public    │
                   └────────────────────────────┘
```

Continue to [02-user-journeys.md](02-user-journeys.md).
