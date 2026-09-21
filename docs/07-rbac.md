# Authentication, roles and access control

Authorisation happens in two independent layers, and both are applied on every
request.

```
   Request
      │
      ├─ 1. Authentication ......... is the session live and the account active?
      │
      ├─ 2. requirePermission(...) . may this role perform this ACTION?
      │
      └─ 3. scope clause ........... which ROWS may they perform it on?
```

Layer 2 without layer 3 is the classic flaw: a manager who may approve expenses
approving *everyone's* expenses. Both are enforced server-side, in SQL.

---

## Authentication

| Property | Choice | Why |
|---|---|---|
| Password hashing | bcrypt, cost 12 | Deliberately slow |
| Access token | JWT, 30 min | Short enough that revocation is cheap |
| Refresh token | 30 days, rotated every use | A stolen token is single-use |
| Reuse detection | Replay revokes the whole family | The only reliable signal of theft |
| Session check | Every request | Deactivation is immediate, not at expiry |
| Lockout | 5 failures → 15 minutes | Slows credential stuffing |
| Enumeration | Identical failure wording | The endpoint cannot confirm who works here |
| Storage (web) | Access token in `sessionStorage`; refresh in an httpOnly cookie | A shared office machine forgets on tab close |
| Storage (mobile) | Both in device storage (Keychain/Keystore under Capacitor) | A phone is personal and often offline |

Sign-in accepts an **employee ID, an email address or a mobile number** —
field staff reliably remember their ADISYS ID.

### Reuse detection, and the bug it caught

Revoking a compromised session family must not happen *inside* the transaction
that detects it — the error raised would roll the revocation back, leaving the
stolen family alive. The test suite caught exactly this; `POST /auth/refresh`
now flags the compromise inside the transaction and revokes after it commits.

---

## Roles

| Role | Permissions | Intent |
|---|---|---|
| **Super Admin** | all 44 | Configure the organisation |
| **Operations / Project Manager** | 29 | Run projects and the people on them |
| **Finance / Accounts Manager** | 15 | Settle money, report organisation-wide |
| **Employee / Field Staff** | 11 | Do the work, claim the costs |

Roles are seeded from `packages/shared/src/permissions.ts` — the same module
the API and both clients import, so the database cannot drift from the code.

---

## Scope suffixes

Permission keys carry their data scope, and it is meaningful:

| Suffix | Rows |
|---|---|
| `.own` | Only the caller's |
| `.team` | Direct and indirect reports, plus members of projects the caller manages |
| `.all` | Organisation-wide |

`resolveScope()` returns the **widest** scope held, and the corresponding SQL
clause is composed into the query. A manager's list query becomes, in effect:

```sql
WHERE ec.user_id = $me
   OR ec.user_id IN (WITH RECURSIVE reports AS (...) SELECT id FROM reports)
   OR ec.project_id IN (SELECT id FROM projects WHERE manager_id = $me)
```

The recursive CTE walks the whole reporting line, so a senior manager sees
their reports' reports without any extra configuration.

---

## Permission catalogue

44 permissions across eight modules.

| Module | Permissions |
|---|---|
| dashboard | `dashboard.view` |
| employee | `view.own` · `view.team` · `view.all` · `create` · `update` · `deactivate` |
| project | `view.assigned` · `view.managed` · `view.all` · `create` · `update` · `assign_members` |
| work | `view.own` · `view.team` · `view.all` · `create` · `update` · `cancel` · `acknowledge` · `progress` · `review` |
| productivity | `time.log` · `time.verify` · `attendance.record` · `productivity.view.own/.team/.all` |
| expense | `create` · `view.own` · `view.team` · `view.all` · `approve.manager` · `approve.finance` · `mark_paid` · `edit_approved` |
| report | `view.own` · `view.team` · `view.all` · `export` |
| settings | `settings.view` · `settings.manage` · `rbac.manage` · `audit.view` |

---

## Per-user overrides

`user_permission_overrides` grants or revokes a single permission for one
person without inventing a role:

- **allow** — a site supervisor who may verify time without becoming an
  Operations Manager (the seed includes this as a worked example).
- **deny** — always wins over the role grant, so least privilege is achievable
  without restructuring the matrix.

Effective permissions are recomputed on every request, so a change takes effect
immediately rather than at the next sign-in.

---

## Rules that hold regardless of permission

Some things are wrong no matter what a role says, and the API refuses them
unconditionally:

| Rule | Enforced in |
|---|---|
| Nobody approves their own expense claim | `applyDecision()` |
| Nobody verifies their own recorded time | `POST /time/entries/:id/verify` |
| Only the assignee acknowledges their work | `acknowledgeOne()` |
| Only the project manager accepts completion | `POST /assignments/:id/review` |
| Finance cannot decide before the manager stage | Stage check in `applyDecision()` |
| Only a Super Admin creates or edits a Super Admin | Employee create/update |
| Nobody changes their own account status or permissions | Employee status / permissions |
| Work can only be assigned to an active project member | `assertProjectMembership()` |
| Expenses can only be booked to a project the employee is on | `assertProjectMembership()` |

---

## Files

An uploaded receipt is reachable only through `GET /api/files/:id`, which
re-derives the caller's right from the record that owns the file:

- The uploader can always read their own upload.
- A claim's receipt follows `expense.view` scope — owner, their manager, the
  project's manager, finance, admin.
- Anything unattached stays private to its uploader.

Storage keys are opaque and content-addressed; the path is never guessable, and
there is no public route to the storage directory. Uploads are validated by
**magic bytes**, not by the declared content type.

---

## Audit

`audit_logs` records actor, role, action, entity, before/after snapshots, IP,
user agent and request id for every state change. Secrets are redacted before
writing. A failure to audit is logged loudly but never blocks the user's action.

Login attempts — successful and failed — are recorded separately in
`login_attempts` with the reason for failure.
