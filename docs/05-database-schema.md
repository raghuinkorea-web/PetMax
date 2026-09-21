# Database schema

PostgreSQL 16. 37 application tables and 7 reporting views (plus the
`schema_migrations` ledger), all created by immutable migrations in
`db/migrations/`.

---

## Design decisions worth stating

### Users and employees are one table

Every authenticated principal at ADISYS *is* a member of staff. Splitting
identity from employment creates two keys for one person, which is the classic
source of double-counting between "user" and "employee" in reports. `users`
carries both, and an `employees` view preserves the domain vocabulary.

### Time is stored as segments, not as a start plus a pause table

A timer run produces one row per stretch of work. "Pause" closes the open
segment; "resume" opens a new one. Elapsed time is therefore always the sum of
*closed* segments — a forgotten pause cannot inflate anyone's hours, and there
is no second table to keep consistent.

```sql
CREATE UNIQUE INDEX uq_time_entry_running
  ON time_entries(user_id) WHERE ended_at IS NULL;
```

One running timer per person, enforced by the database rather than by the API.

### Assignments are versioned

`work_assignments.version` increments whenever a field that changes the
*substance* of the work is edited. Acknowledgements record the version they
were given:

```sql
CREATE UNIQUE INDEX uq_ack_assignment_version
  ON assignment_acknowledgements(assignment_id, assignment_version);
```

An acknowledgement of version 1 does not satisfy version 2. The app surfaces
this as "changed since you acknowledged it", and the earlier acknowledgement is
retained rather than overwritten.

### Approval trails are append-only

`expense_approvals` is never updated or deleted. A claim that is submitted,
returned, corrected and resubmitted reads `submitted → returned → resubmitted`
with every comment intact.

### Completion percentage is derived, never stored

`v_project_progress` computes it from the assignments. A stored column would
drift the moment an assignment was added or cancelled.

### Location columns cannot be populated without consent

```sql
CONSTRAINT chk_geo_requires_consent CHECK (
  location_consented OR (check_in_latitude IS NULL AND check_out_latitude IS NULL))
```

The privacy rule is a database constraint, not a code convention.

---

## Entity groups

### Identity and access (migration 001)

| Table | Purpose |
|---|---|
| `users` | Staff identity, employment attributes, credentials, status |
| `roles` · `permissions` · `role_permissions` | The RBAC matrix |
| `user_permission_overrides` | Per-user allow/deny; deny always wins |
| `departments` · `designations` · `work_locations` | Organisation structure |
| `auth_sessions` | Refresh-token sessions with rotation and revocation |
| `login_attempts` · `password_reset_tokens` | Security audit and recovery |
| `app_enum` | Configurable status vocabularies |

### Projects and work (002)

| Table | Purpose |
|---|---|
| `projects` · `project_types` | Client engagements |
| `project_members` | **The authorisation edge** — an employee may only log time or claim expenses against a project they are an active member of |
| `work_assignments` · `work_types` | Daily and weekly work, versioned |
| `assignment_acknowledgements` | Receipt of work, per version, with device and IP |
| `work_assignment_events` | Immutable transition trail |

### Time and attendance (003)

| Table | Purpose |
|---|---|
| `attendance_sessions` | On duty — availability only |
| `time_entries` | Time against an assignment, with verification state |

### Files and expenses (004)

| Table | Purpose |
|---|---|
| `files` | Opaque storage keys, checksums, never publicly served |
| `expense_categories` | Two levels, with receipt rules and limits |
| `expense_claims` | The claim itself, with category-specific columns |
| `expense_attachments` | Receipts, with OCR state and confirmation flag |
| `expense_approvals` | Append-only decision trail |
| `expense_policies` | **Approval routing as data** |
| `reimbursement_batches` · `reimbursement_items` | Settlement; a claim can be paid once |
| `work_assignment_attachments` | Instruction documents and work proof |

### Operations (005)

| Table | Purpose |
|---|---|
| `notifications` · `notification_preferences` · `notification_outbox` · `push_devices` | In-app now, push/email via an outbox worker |
| `audit_logs` | Actor, action, entity, before/after, IP, request id |
| `settings` | Scoped JSONB documents, validated server-side |
| `code_counters` + `next_code()` | Gap-free document codes (`ADI-0005`, `PRJ-0003`, `EXP-2026-0142`) |

### Reporting views (006)

| View | What it guarantees |
|---|---|
| `employees` | Domain vocabulary over `users` |
| `v_assignment_acknowledgement` | Current acknowledgement state, including "changed since" |
| `v_time_daily` | Recorded, verified and unassigned minutes — kept separate |
| `v_attendance_daily` | On-duty minutes, never mixed with work time |
| `v_expense_claims` | **The single base relation for every expense figure** |
| `v_project_summary` · `v_project_progress` | Project rollups and derived completion |

`v_expense_claims` is why employee-wise and project-wise totals reconcile
exactly: both are groupings of the same rows. The test suite asserts it.

---

## Integrity at a glance

Figures below are counted from the live schema, not estimated.

| Mechanism | Count | Examples |
|---|---|---|
| Foreign keys | 67 | Every relationship |
| Explicit check constraints | 51 | Amount > 0; due date ≥ assignment date; rejection requires a reason; geo requires consent |
| Unique indexes (excluding primary keys) | 24 | One running timer; one open attendance session; one acknowledgement per version; one payment per claim |
| Partial indexes | 22 | Soft-deleted rows excluded from hot paths |
| Indexes in total | 105 | Every foreign key and common filter |
| Triggers | 10 | `updated_at` maintenance |

Soft deletion (`deleted_at`) on `users`, `projects`, `work_assignments`,
`expense_claims` and `files` — financial and work history must survive the
removal of a person or a project.

---

## Codes

`next_code(entity, prefix, period, width)` allocates atomically:

| Entity | Format | Example |
|---|---|---|
| Employee | `ADI-0000` | `ADI-0005` |
| Project | `PRJ-0000` | `PRJ-0003` |
| Assignment | `WRK-0000` | `WRK-0187` |
| Expense | `EXP-YYYY-0000` | `EXP-2026-0142` |
| Reimbursement | `REIMB-YYYY-000` | `REIMB-2026-001` |

---

## Migrations

`apps/api/scripts/migrate.mjs` applies each file once, inside a transaction,
recording a SHA-256 checksum. **Editing an applied migration is detected and
refused** — add a new one instead.

```bash
npm run db:migrate     # apply pending
npm run db:reset       # drop, recreate, migrate, seed  (development only)
npm run db:seed        # reseed the demonstration dataset
```
