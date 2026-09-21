# API specification

`https://<host>/api` · JSON · bearer authentication · **101 routes**

The route list below is generated from the live Express router
(`npx tsx --env-file=.env apps/api/scripts/list-routes.mjs`), so it cannot
drift from what the server actually serves.

---

## Conventions

### Authentication

Every route except `/api/health` and `/api/auth/{login,refresh,forgot-password,reset-password}`
requires:

```
Authorization: Bearer <access token>
```

A valid token is **not** sufficient on its own. On every request the API
re-checks that the session is still live and the account is still active, so
deactivating someone takes effect immediately rather than at token expiry.

- Access token: JWT, 30 minutes (configurable).
- Refresh token: 30 days, **rotated on every use**. The web client holds it in
  an httpOnly cookie; the mobile client sends it in the body from secure
  storage. Replaying a retired refresh token revokes the entire session family.

### Errors

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Please correct the highlighted fields.",
    "details": { "amount": ["Enter an amount greater than zero"] },
    "requestId": "0f8c2a61-..."
  }
}
```

| Status | Codes |
|---|---|
| 400 | `BAD_REQUEST` |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND`, `ROUTE_NOT_FOUND` |
| 409 | `CONFLICT`, `INVALID_TRANSITION`, `ACKNOWLEDGEMENT_REQUIRED`, `TIMER_RUNNING`, `NO_TIMER`, `TIME_OVERLAP`, `POSSIBLE_DUPLICATE`, `CLAIM_LOCKED`, `ASSIGNMENT_CLOSED`, `NOT_PENDING`, `ALREADY_CHECKED_IN`, `NOT_CHECKED_IN`, `OPEN_WORK_EXISTS` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 422 | `VALIDATION_FAILED` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` |

`details` is keyed by field name, which is what drives inline form validation
in both clients. **Records outside the caller's scope return 404, not 403** —
"this exists but you may not see it" is itself a disclosure.

### Pagination, filtering and sorting

```
GET /api/expenses?page=1&size=25&sort=amount&dir=desc&status=submitted&from=2026-09-01
```

```json
{ "data": [...], "page": { "number": 1, "size": 25, "total": 142, "totalPages": 6 } }
```

List endpoints that aggregate also return a `totals` object computed over the
**whole filtered set**, not just the current page.

### Rate limiting

600 requests / 15 min per IP; 10 sign-in attempts / 15 min. An account locks
for 15 minutes after 5 consecutive failures.

---

## Routes

### Authentication — `/api/auth`

| Method | Path | Notes |
|---|---|---|
| POST | `/login` | Employee ID, email or mobile. Uniform failure message |
| POST | `/refresh` | Rotates; replay revokes the family |
| POST | `/logout` | Revokes the current session |
| GET | `/me` | Identity plus effective permissions |
| GET | `/permissions` | Permission catalogue for the caller |
| GET | `/sessions` | Signed-in devices |
| DELETE | `/sessions/:id` | Sign out one device |
| POST | `/change-password` | Signs out every other device |
| POST | `/forgot-password` | Identical response whether or not the account exists |
| POST | `/reset-password` | Consumes a single-use token |

### Lookups — `/api/lookups`

| Method | Path | Notes |
|---|---|---|
| GET | `/` | Everything a form needs in one request: projects the caller may use, the category tree, master data, the status vocabulary and every metric definition. The mobile app caches this |
| GET | `/assignable-employees` | Active members of a project |

### Work assignments — `/api/assignments`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/` | `work.view.*` | Views: today, tomorrow, this_week, next_week, overdue, pending_ack |
| POST | `/` | `work.create` | Multiple assignees and `repeatUntil` in one transaction |
| GET | `/my-week` | — | Grouped by day with per-day acknowledgement counts |
| GET | `/:id` | `work.view.*` | Assignment, events, acknowledgements, time entries, attachments |
| PATCH | `/:id` | `work.update` | A material edit bumps `version` and invalidates the acknowledgement |
| POST | `/:id/acknowledge` | `work.acknowledge` | `acknowledged` or `clarification_requested` |
| POST | `/acknowledge-bulk` | `work.acknowledge` | Day or week; **never marks anything complete** |
| GET | `/acknowledge-bulk/preview` | — | Powers the confirmation screen |
| POST | `/:id/status` | — | Transitions validated against the state machine |
| POST | `/:id/progress` | `work.progress` | Percentage plus a note |
| POST | `/:id/review` | `work.review` | Accept, or return with a mandatory comment |

### Time and attendance — `/api/time`

| Method | Path | Permission |
|---|---|---|
| GET | `/timer` | — |
| POST | `/timer/start` · `/timer/pause` · `/timer/stop` | `time.log` |
| GET | `/entries` | scoped |
| POST | `/entries` | `time.log` — overlap and back-dating checked |
| POST | `/entries/:id/verify` | `time.verify` — **cannot verify your own** |
| POST | `/entries/verify-bulk` | `time.verify` |
| GET | `/attendance/today` | — |
| POST | `/attendance/check-in` · `/check-out` | `attendance.record` |
| POST | `/attendance/location-consent` | — grant or revoke |

### Expenses — `/api/expenses`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/` | `expense.view.*` | `queue=mine\|awaiting_me\|all`; returns filtered totals |
| GET | `/my-summary` | — | Tiles for the employee app |
| POST | `/` | `expense.create` | `multipart/form-data` with up to 5 receipts |
| GET | `/:id` | scoped | Claim, attachments, approval trail, possible duplicates, resolved policy |
| PATCH | `/:id` | `expense.create` | Draft or returned claims only |
| POST | `/:id/submit` | `expense.create` | Submit or resubmit |
| POST | `/:id/cancel` | `expense.create` | |
| POST | `/:id/receipts` | `expense.create` | Add receipts |
| DELETE | `/:id/receipts/:attachmentId` | `expense.create` | |
| POST | `/:id/receipts/:attachmentId/ocr` | `expense.create` | Queues extraction; always requires employee confirmation |
| POST | `/:id/decision` | `expense.approve.*` | approve · reject · return |
| POST | `/decision-bulk` | `expense.approve.*` | Each claim decided independently |
| POST | `/reimburse` | `expense.mark_paid` | Creates a batch; a claim can be paid once |

### Files — `/api/files`

| Method | Path | Notes |
|---|---|---|
| GET | `/:id` | **The only way to read an uploaded file.** Holding the id is not authorisation: the caller's right to the owning record is re-checked, then the bytes are streamed with `no-store` and `nosniff` |

### Projects, employees, dashboard, reports, notifications, settings

| Group | Routes |
|---|---|
| `/api/projects` | list · create · detail · update · activity · add members · remove member |
| `/api/employees` | list · create · detail · update · status · reset credentials · get/set permission overrides |
| `/api/dashboard` | `/` KPIs · `/charts` · `/attention` · `/my-day` (the whole employee home screen in one request) |
| `/api/reports` | catalogue · productivity summary & daily · work register · expense detail/by-employee/by-project/by-category/monthly/approval-turnaround · project summary. Every one accepts `format=csv` |
| `/api/notifications` | list · unread count · mark read · mark all · preferences · register/remove push device |
| `/api/settings` | settings documents · master data · expense categories · approval policies · roles · audit log |

---

## Validation

Every request body is parsed with a Zod schema before a handler runs. Nothing
reaches the database unvalidated, and the same schema produces the field-level
`details` the clients render inline.

Business rules that the interface *also* shows are enforced here regardless:
project membership, category limits, the back-dating window, receipt
requirements, duplicate detection, state transitions, and approval authority.
The clients are a convenience; the API is the rule.

---

## CSV export

```
GET /api/reports/expenses/detail?from=2026-09-01&to=2026-09-30&format=csv
```

Returns `text/csv` with a dated filename. Values beginning `=`, `+`, `-` or `@`
are prefixed with an apostrophe to neutralise formula injection when the file
is opened in Excel. Every export is recorded in the audit log.
