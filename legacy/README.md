# Dumping Tool

Self-hosted web app that takes scheduled **PostgreSQL** and **MySQL/MariaDB** dumps, emails you when they finish, and lets you sign in to download them.

- **Dashboard with login:** accounts are created by an admin. Users see only their own jobs and dumps. Admins see everything.
- **4-step job wizard:** pick the engine, then enter the connection (fields or a connection URI). **Test connection** lists the databases you can back up. Then choose the schedule and the notifications.
- **Schedules:** on demand, one time, daily, weekly (pick days), or custom cron, each in its own timezone. Schedules are stored in MongoDB, so they survive restarts. Runs missed while the server was asleep are caught up on the next start.
- **Real dump tools:** uses `pg_dump` / `mysqldump` and streams the output through gzip. It records the size, duration and SHA-256 checksum of every dump.
- **Email notifications:** sent when a dump succeeds or fails, through SMTP, Brevo or Resend.
- **Retention:** keeps the last *N* successful dumps per job and deletes older files automatically.
- **Storage:** local disk, or any S3-compatible bucket (Backblaze B2, Cloudflare R2, AWS S3, MinIO).
- **Live UI:** server-sent events update running dumps, toasts, countdowns and the activity chart in real time.
- **Responsive, animated UI:** dark and light themes, and it respects `prefers-reduced-motion`.

## Tech stack

| Layer | Choice |
|---|---|
| Server | Node.js 22, Express 5 |
| Database | MongoDB (Mongoose): users, jobs, dump metadata |
| Scheduler | DB-backed polling scheduler + [croner](https://github.com/hexagon/croner) for cron/timezones |
| Dumps | `pg_dump` (PostgreSQL client 18), `mysqldump` (MariaDB client) |
| Storage | Local filesystem or S3 API (`@aws-sdk/client-s3`) |
| Email | Nodemailer (SMTP), Brevo / Resend HTTPS APIs |
| Auth | bcrypt password hashes, JWT in an HttpOnly cookie, login rate limiting |
| Frontend | Dependency-free vanilla JS SPA (ES modules), hand-written CSS |
| Packaging | Docker image containing the dump clients |

## How it works

```
Browser ──HTTPS──► Express API ──► MongoDB (users, jobs, dumps)
   ▲  SSE (live status)   │
   └──────────────────────┤
                          ▼
                  Scheduler (every 20s: find jobs with nextRunAt <= now)
                          │  optimistic claim → queue (max N parallel)
                          ▼
             pg_dump / mysqldump ──► gzip ──► temp file ──► Storage (disk / S3)
                          │
                          └──► Email notification ──► "Sign in & download" link
```

## Security notes

- **Encrypted DB passwords:** passwords for the databases you back up are encrypted with AES-256-GCM, using a key derived from `ENCRYPTION_KEY`. The API never returns them.
- **Safe command execution:** dump tools run through `spawn` with argument arrays and no shell. The Postgres password is passed via `PGPASSWORD`. The MySQL password goes in a temporary `0600` option file that is deleted afterwards. Hosts, usernames and database names that look like CLI options are rejected.
- **Private downloads:** dumps are only served to their owner (or an admin), streamed through the authenticated API.
- **Sessions:** HttpOnly, SameSite=Lax cookies. Changing a password signs out all other sessions.
- **HTTP hardening:** Helmet with a strict CSP (`script-src 'self'`), and login and connection-test rate limits.

## Run locally

Requirements: Node 20+ and MongoDB. The `pg_dump` and/or `mysqldump` binaries must be on your `PATH` (or set `PG_DUMP_PATH` / `MYSQLDUMP_PATH`).

```bash
npm install
cp .env.example .env      # then edit: MONGO_URI, ADMIN_EMAIL, ADMIN_PASSWORD
npm run dev               # http://localhost:8080
```

With Docker (includes MongoDB and the dump tools):

```bash
cp .env.example .env
docker compose up -d --build
```

Run the tests with `npm test`.

## Deploying for free

See **[DEPLOYMENT.md](DEPLOYMENT.md)**. It is a step-by-step guide to a $0 setup on Render + MongoDB Atlas + Backblaze B2 + Brevo.

## Project structure

```
src/
  server.js              Express app, security headers, admin bootstrap, startup
  config.js              Environment configuration
  models/                User, Job, Dump (Mongoose)
  routes/                auth, jobs, dumps (+SSE, download), users, stats/system
  services/
    scheduler.js         DB-backed scheduler (restart/sleep safe)
    runner.js            Queue, concurrency, retention, notifications
    dumper/              pg_dump / mysqldump runners, binary detection, connection probe
    storage/             local + S3 drivers
    mailer.js            SMTP / Brevo / Resend + HTML email template
  lib/                   crypto, schedule maths, validation (zod), SSE event bus
public/                  SPA: index.html, css/app.css, js/(app|ui|api).js, js/views/*
test/                    node:test unit tests
Dockerfile, docker-compose.yml, render.yaml
```
