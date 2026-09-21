# Information architecture

Two applications, one API, one vocabulary.

---

## Admin web portal

Navigation is grouped by *what you are doing*, not by database table, and each
item is hidden entirely unless the signed-in role holds the permission for it.

```
ADISYS FieldOps
│
├── OPERATIONS
│   ├── Dashboard ............... dashboard.view
│   ├── Work assignments ........ work.view.team | work.view.all
│   │     └── (drawer) Assignment detail: facts, acknowledgement history, activity, review
│   ├── Productivity ............ productivity.view.team | .all
│   │     ├── Per employee
│   │     └── Time awaiting verification
│   └── Projects ................ project.view.managed | .all
│         └── Project workspace
│               ├── Overview ..... progress, budget, spend by category and month
│               ├── Team ......... members, allocation, open work
│               ├── Work ......... every assignment on the project
│               ├── Expenses ..... spend by employee, reconciled to the total
│               └── Activity log . every status transition
│
├── FINANCE
│   ├── Expenses ................ expense.view.team | .all
│   │     └── Claim detail: amount, receipts, approval route, decision panel
│   ├── Approval queue .......... expense.approve.manager | .finance   [badge]
│   └── Reports ................. report.view.team | .all
│
└── ADMINISTRATION
    ├── Employees ............... employee.view.team | .all
    │     └── Employee profile: projects, work, productivity, expenses
    ├── Roles & permissions ..... rbac.manage
    ├── Settings ................ settings.view
    │     ├── Organisation · Productivity · Expenses · Notifications · Security
    │     ├── Expense categories
    │     └── Approval policies
    └── Audit log ............... audit.view
```

Always reachable from the header: **Notifications**, **Account & security**,
**Sign out**.

### Why this grouping

- An operations manager lives in the first group and rarely leaves it.
- Finance lives in the second and needs nothing from the first.
- Administration is separated because it changes *how the system behaves*,
  not *what happened today* — a different kind of action deserving a different
  neighbourhood.

---

## Employee Android app

Five tabs, chosen so that the two things done twenty times a day are one tap
from anywhere.

```
┌─────────────────────────────────────────────┐
│  Home     My work    Expenses   Alerts  Profile │
└─────────────────────────────────────────────┘

Home
├── On duty card ............ check in / check out, live timer
├── Today: assigned · in progress · completed
├── Acknowledgement prompt ... when anything is outstanding
├── Overdue banner ........... when anything is late
├── Today's work ............. task cards
├── Expenses summary ......... + Add an expense
└── This week ................ recorded vs verified hours

My work                              [badge: awaiting acknowledgement]
├── Today · Tomorrow · This week · Next week · To acknowledge · Completed · All
├── Bulk acknowledge (day | week) → confirmation sheet
└── Assignment detail
      ├── Facts: due, planned, recorded, site, assigned by
      ├── Acknowledgement state (or the prompt to acknowledge)
      ├── Site instructions
      ├── Manager's review comment
      ├── Progress
      ├── Time you recorded (with verification state)
      └── Action bar: Start / Pause · Mark done

Expenses
├── Tiles: awaiting · approved · needs correction · reimbursed
├── Filters: all · awaiting · returned · approved · drafts
├── Claim list
├── Add expense
│     ├── Step 1: category (large tap targets)
│     └── Step 2: bill photo → amount → project → category fields
└── Claim detail: amount, bills, history, resubmit when returned

Alerts                                            [badge: unread]
└── Tapping an alert opens the assignment or claim it refers to

Profile
├── Identity and this week's hours
├── Change password
├── Location at check-in (consent, explained and revocable)
├── Signed-in devices
└── Sign out
```

Screens that need the whole viewport — assignment detail, add expense, claim
detail — sit outside the tab shell, so the content is never competing with the
navigation bar.

---

## Shared vocabulary

Statuses, their labels, their colour tone and their descriptions are declared
once in `packages/shared/src/domain.ts` and consumed by the API, both clients
and every export. A status cannot read "Acknowledgement pending" in one place
and "Assigned" in another, because there is only one definition.

| Domain | Values |
|---|---|
| Work status | assigned · acknowledged · in_progress · on_hold · submitted · completed · clarification_requested · cancelled |
| Expense status | draft · submitted · under_review · returned · approved · rejected · reimbursement_pending · paid · cancelled |
| Project status | draft · active · on_hold · completed · cancelled |
| Priority | low · medium · high · critical |
| Employee status | invited · active · inactive · suspended |
| Time verification | unverified (Recorded) · verified · rejected (Discounted) |

Permitted transitions are declared alongside them and enforced by the API.

---

## URL structure

| Admin portal | Employee app |
|---|---|
| `/` dashboard | `/` home |
| `/work`, `/work?view=overdue` | `/work`, `/work?view=this_week` |
| `/productivity` | `/work/:id` |
| `/projects`, `/projects/:id` | `/expenses` |
| `/employees`, `/employees/:id` | `/expenses/new`, `/expenses/:id` |
| `/expenses`, `/expenses/:id` | `/notifications` |
| `/approvals` | `/profile`, `/profile/devices` |
| `/reports`, `/settings`, `/roles`, `/audit` | `/login`, `/forgot-password` |

Filter state lives in the query string, so a manager can send a colleague a
link to exactly the view they are looking at.
