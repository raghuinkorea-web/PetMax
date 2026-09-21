# Deployment

---

## Requirements

| | Minimum |
|---|---|
| Node.js | 20 LTS (22 recommended) |
| PostgreSQL | 15+ (16 used in development) |
| Storage | A filesystem volume, or S3-compatible object storage |
| TLS | Required. Refresh cookies are `Secure` in production |

---

## Environment

Copy `.env.example` to `.env` and replace **every** secret.

```bash
cp .env.example .env
openssl rand -hex 48   # JWT_ACCESS_SECRET
openssl rand -hex 48   # JWT_REFRESH_SECRET
```

| Variable | Notes |
|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:5432/adisys_fieldops` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | 48+ random bytes each, **different from each other** |
| `ACCESS_TOKEN_TTL_MIN` / `REFRESH_TOKEN_TTL_DAYS` | 30 / 30 |
| `STORAGE_DRIVER` | `local` or `s3` |
| `MAX_UPLOAD_MB` | 10 |
| `ALLOWED_UPLOAD_MIME` | Enforced against magic bytes, not the declared type |
| `CORS_ORIGINS` | Exact origins of the two apps. Never `*` |
| `RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_MAX` | 600 / 10 per 15 min |
| `BCRYPT_ROUNDS` | 12 |

> `.env` is gitignored. Use your platform's secret manager in production.

---

## First run

```bash
npm install
npm run build -w @adisys/shared    # the shared package must be built first
npm run db:migrate
npm run db:seed                    # demonstration data — SKIP in production
npm run dev                        # api :4000 · admin :5173 · employee :5174
```

Sign in with `ADI-0001` and the seeded password.

### Production build

```bash
npm run build          # shared → api → admin → employee
npm run db:migrate
npm start -w @adisys/api
```

`apps/admin/dist` and `apps/employee/dist` are static bundles — serve them from
nginx, a CDN or any static host, with `/api` reverse-proxied to the API.

---

## Containerised deployment

`docker-compose.yml` brings up Postgres, the API and both static bundles behind
nginx:

```bash
docker compose up --build
```

For production, run migrations as a one-shot job before rolling the API:

```bash
docker compose run --rm api npm run db:migrate
```

---

## Reverse proxy

```nginx
server {
  listen 443 ssl http2;
  server_name fieldops.adisystech.com;

  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy strict-origin-when-cross-origin always;

  client_max_body_size 12M;          # receipts are capped at 10 MB

  location /api/ {
    proxy_pass http://api:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;   # required for Secure cookies
  }

  location / {
    root /srv/adisys/admin;
    try_files $uri $uri/ /index.html;
  }
}
```

The API sets `trust proxy`, so client IPs in the audit log and rate limiter are
the real ones.

---

## Building the Android application

The employee app is a React PWA that Capacitor compiles into a real Android
package — the same code, the same screens, with native camera, push and secure
storage.

### Prerequisites

Android Studio with SDK 34+, JDK 17.

### One-time setup

```bash
cd apps/employee
npm install @capacitor/core @capacitor/cli @capacitor/android \
            @capacitor/camera @capacitor/push-notifications \
            @capacitor/preferences @capacitor/splash-screen @capacitor/keyboard
npx cap add android
```

`capacitor.config.ts` is already committed with the app id
(`com.adisystech.fieldops`), the ADISYS splash colours and camera quality tuned
for receipts.

### Each build

```bash
npm run build          # produces dist/
npx cap sync android
npx cap open android   # then Build → Generate Signed Bundle / APK
```

### Native integration points

| Capability | Where the web code already handles it | What the plugin adds |
|---|---|---|
| Camera | `<input capture="environment">` opens the rear camera | `@capacitor/camera` gives resolution control and works offline-first |
| Push | `POST /api/notifications/devices` registers a token | `@capacitor/push-notifications` supplies the FCM token |
| Secure storage | `localStorage` | `@capacitor/preferences` maps to Keystore |
| Location | `navigator.geolocation` at check-in only | Native permission prompt |

### Firebase Cloud Messaging

1. Create a Firebase project, add the Android app with the id above.
2. Put `google-services.json` in `android/app/`.
3. Server side, implement the outbox worker that reads
   `notification_outbox WHERE channel = 'push' AND status = 'queued'`, sends via
   FCM using the tokens in `push_devices`, and marks each row sent or failed.
   The write side is complete; only delivery remains.

### Distribution

Internal distribution via Play Console's internal testing track, or a signed
APK on the ADISYS MDM. The PWA at `/` remains installable from Chrome as a
fallback for staff without the store build.

---

## Backup and recovery

```bash
pg_dump --format=custom --file=adisys-$(date +%F).dump "$DATABASE_URL"
```

Receipts live outside the database. Back up `STORAGE_LOCAL_PATH` on the same
schedule, or use S3 with versioning and a lifecycle policy. **A database backup
without the receipts is not a recoverable backup** — approved claims would lose
their evidence.

Recommended: nightly full dump with 30-day retention, WAL archiving for
point-in-time recovery, and a **restore rehearsal every quarter**. An untested
backup is a hypothesis.

---

## Operations

| Concern | Provision |
|---|---|
| Health | `GET /api/health` reports database connectivity; returns 503 when it cannot reach Postgres |
| Correlation | Every response carries `x-request-id`; it appears in error bodies and the audit log |
| Logging | Structured to stdout for the platform's collector |
| Graceful shutdown | SIGTERM drains connections, then closes the pool |
| Connection pool | 20 connections; raise with instance count in mind |
| Retention | `settings.security.policy.auditRetentionDays` (default 7 years) and `productivity.location_policy.retentionDays` (default 180) |

### Still to build before a production rollout

Stated explicitly so nothing is assumed complete:

1. **Notification delivery worker** — the outbox is written but not drained.
2. **OCR worker** — the endpoint queues; extraction is not implemented.
3. **Scheduled jobs** — acknowledgement reminders, overdue escalation, the
   evening digest, and retention pruning.
4. **Object storage driver for S3** — the interface is in place; only the local
   driver is implemented.
5. **CI pipeline** — see [08-testing-strategy.md](08-testing-strategy.md).

---

## Security checklist before go-live

- [ ] Fresh, distinct JWT secrets from a secret manager
- [ ] `CORS_ORIGINS` set to exact origins
- [ ] TLS terminated, HSTS enabled, `X-Forwarded-Proto` passed through
- [ ] Database user restricted to the application schema
- [ ] Storage volume not served by any web server
- [ ] Seed data **not** loaded, and the demonstration accounts removed
- [ ] Rate limits reviewed for the real user count
- [ ] Backup *and* restore rehearsed
- [ ] Audit retention agreed with Finance
- [ ] Location policy reviewed and communicated to field staff
