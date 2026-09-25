<div align="center">

# ADISYS FieldOps

**On-field employee productivity, project and expense management**

*Observation Driven Insights* · [adisystech.com](https://www.adisystech.com)

</div>

---

ADISYS FieldOps is the system of record for what field staff were asked to do,
what they actually did, how long it took, and what it cost.

| | |
|---|---|
| **Admin web portal** | React · Vite · TypeScript · Tailwind v4 — desktop and tablet |
| **Employee app** | Mobile-first React PWA, wrapped by Capacitor into an installable Android app |
| **API** | Node · Express · TypeScript · Zod — RBAC enforced on every request |
| **Database** | PostgreSQL 16 — 37 tables, 7 reporting views, full audit trail |
| **Tests** | 58 integration tests against a real database, all passing |

---

## Run it

```bash
npm install
npm run build -w @adisys/shared     # the shared package must be built first
npm run db:migrate
npm run db:seed
npm run dev
```

| | |
|---|---|
| Admin portal | http://localhost:5173 |
| Employee app | http://localhost:5174 |
| API health | http://localhost:4000/api/health |

### Demonstration accounts

Password for every account: `Adisys@2026`

| Employee ID | Name | Role | Try |
|---|---|---|---|
| `ADI-0001` | Anitha Reddy | Super Admin | Everything |
| `ADI-0002` | Suresh Menon | Operations Manager | Assign work, review completion, approve expenses |
| `ADI-0004` | Kavitha Rao | Finance Manager | The approval queue and financial reports |
| `ADI-0005` | Arun Prakash | Field Employee | **Sign in on the employee app** — acknowledge work, submit a bill |

The seed builds three weeks of operating history: 15 people, 7 projects,
208 assignments, 191 time entries, 90 expense claims across every approval
state, with real receipt files.

---

## The four ideas the product is built on

### 1. Acknowledgement is receipt, never completion

A manager assigns work; the employee acknowledges it against the exact
*version* they were shown. Change the scope and the acknowledgement is
invalidated automatically — the app says *"changed since you acknowledged it"*
and asks again. Bulk acknowledgement exists, and it completes nothing.

### 2. Three measures of time, never merged

| On duty | Recorded | Verified |
|---|---|---|
| Check-in to check-out | Logged against an assignment | Confirmed by a manager |

**Only verified hours are reported as productive.** Time logged without an
assignment is reported separately and never counted. Being signed in produces
no productivity figure at all — the schema makes it impossible.

### 3. A photograph of a bill becomes a settled claim

Camera → amount → project → submit, in under a minute. The server checks the
category's limits, the back-dating window, project membership, receipt
requirements and likely duplicates. The approval route comes from
`expense_policies` rows, not from code. A returned claim keeps its whole
history through correction and resubmission.

### 4. Figures that reconcile

Every expense number in the product derives from one view, so employee-wise and
project-wise totals are two groupings of the same rows. A test asserts they
agree to the paisa. Every metric carries its definition wherever it is shown.

---

## Screens

| Admin portal | Employee app |
|---|---|
| ![Dashboard](docs/screenshots/admin-dashboard.png) | ![Home](docs/screenshots/app-home.png) |
| The dashboard, scoped to what the signed-in role may see | The field app: on duty, today's work, expenses |

More in [docs/screenshots](docs/screenshots/README.md).

---

## Documentation

| | |
|---|---|
| [Product overview](docs/01-product-overview.md) | What it does, and what it deliberately does not |
| [User journeys](docs/02-user-journeys.md) | Eight journeys, each built end to end |
| [Information architecture](docs/03-information-architecture.md) | Both apps, screen by screen |
| [Design system](docs/04-design-system.md) | Brand, colour, the validated chart palette, accessibility |
| [Database schema](docs/05-database-schema.md) | 37 tables and the decisions behind them |
| [API specification](docs/06-api-specification.md) | 101 routes, generated from the live router |
| [RBAC & security](docs/07-rbac.md) | Two-layer authorisation, in SQL |
| [Testing strategy](docs/08-testing-strategy.md) | What is tested, and what is not |
| [Deployment](docs/09-deployment.md) | Docker, nginx, and building the Android APK |

---

## Repository layout

```
adisys-fieldops/
├── apps/
│   ├── api/          Express API · routes, services, migrations runner, tests
│   ├── admin/        Admin web portal
│   └── employee/     Employee PWA + Capacitor Android config
├── packages/
│   └── shared/       Permissions, status vocabulary, formatting, API types
├── db/migrations/    Immutable, checksummed SQL migrations
├── docs/             The documents listed above
├── deploy/           nginx configuration
└── storage/          Private receipt storage (gitignored)
```

`packages/shared` is the contract. The permission catalogue, every status and
its label, and the formatting of a rupee are declared once and imported by the
API, both clients, the seed and the tests — so they cannot drift.

---

## Commands

| | |
|---|---|
| `npm run dev` | API + both apps, with prefixed output |
| `npm test` | 58 integration tests against a real database |
| `npm run typecheck` | Every workspace |
| `npm run build` | shared → api → admin → employee |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:reset` | Drop, recreate, migrate, seed (**development only**) |
| `docker compose up --build` | Postgres, API and both apps behind nginx |

---

## The ADISYS logo

Both apps ship the official artwork in their `public/` directory:
`adisys-logo.png` (the full lockup) and `adisys-wordmark.png` (the lettering
alone, for places too short to carry the tagline). On dark panels the mark is
knocked out to white, since the tagline is near-black.

To substitute different artwork, set `VITE_BRAND_LOGO_URL` and
`VITE_BRAND_WORDMARK_URL`. See [the design system](docs/04-design-system.md#the-wordmark).

---

## Status

Phases 1–5 are implemented: branding and design system, authentication and
RBAC, employee and project management, work assignment and acknowledgement,
time and productivity, the full expense lifecycle through to reimbursement,
reporting with CSV export, notifications, settings, and the audit log.

Known gaps are listed explicitly in
[deployment](docs/09-deployment.md#still-to-build-before-a-production-rollout)
and [testing](docs/08-testing-strategy.md#what-is-not-covered-and-what-that-means)
— principally the notification delivery worker, the OCR worker, scheduled
reminder jobs, and the S3 storage driver.
