# DBRB Product Plan v2: multi-tenant, compliance-first backup platform on AWS

> **Status:** **approved** (30 Sep 2026). Changes will be handled as they come up during the phases. Domain purchase approved. Primary AWS region: **Mumbai (`ap-south-1`)**. Product name: **DBRB**, *"Your database will be right back."* (see [BRAND.md](BRAND.md)).
> **Research date:** 30 Sep 2026.
> **Caveats:** AWS prices are approximate on-demand figures and must be checked in the [AWS Pricing Calculator](https://calculator.aws/) for your region before you spend. This is not legal advice; have a lawyer review the Terms, Privacy Policy and DPA before any paid launch.

---

## 0. Decision log

| # | Topic | Decision |
|---|---|---|
| 1 | Goal | Portfolio first, but architected to become a paid product without a rewrite |
| 2 | Delivery | **Open-core**: a free self-hosted edition plus a hosted cloud with paid plans |
| 3 | License | **AGPL-3.0 core + commercial license for `ee/` (enterprise) code + CLA**, the Cal.com / GitLab model |
| 4 | App database | **MySQL 8.4 LTS** (not Postgres, not MongoDB) |
| 5 | Tenancy | **One MySQL database per tenant on a shared server**; Enterprise tenants can be moved to a dedicated instance |
| 6 | Dump storage | **Both modes**: the customer's own bucket (BYO), *or* our managed S3 billed per GB |
| 7 | Cloud | **AWS**. Start at about **$10–25/month**, load-balancer-ready but single instance until traffic needs more |
| 8 | Plans | Free, Pro, Max, Enterprise (custom, contact sales), Self-hosted (community free + paid license key) |
| 9 | Plan expiry | Reminders → 7-day grace → **everything paused**, read-only for 30 days → notices → deletion |
| 10 | Payments | **Decide later.** Build a provider-agnostic billing layer with a test-mode provider now |
| 11 | Notifications at launch | **Email + in-app**. Architecture ready for Slack, webhooks and SMS later |
| 12 | Frontend | **React + TypeScript** |
| 13 | Languages | English + Hindi at launch, then Spanish, Portuguese (BR), German, French, Japanese; Arabic (RTL) later |
| 14 | Time budget | 6–8 hours/week, possibly 12–16. Estimates below are in **hours** |
| 15 | Name | **DBRB** ("DB, be right back" / DataBase Restore & Backup). Primary domain `dbrb.dev`, GitHub org `dbrbhq`. See [BRAND.md](BRAND.md) |

### Why AGPL-3.0 + commercial (plain-English)
- **What the free edition allows:** anyone can use, self-host and modify the core for free. If someone runs a *modified* version as a service for others, they must publish their changes. That stops a big company from quietly reselling your product.
- **What you sell:** enterprise features live in an `ee/` folder under a commercial license. They're available through the paid cloud plans or a **self-hosted license key**, which is your self-hosted billing tier.
- **The CLA:** a one-click GitHub bot. Contributors grant you the right to also sell their contributions commercially. Without it, you couldn't dual-license.
- **The alternative:** the Functional Source License (FSL) offers more protection, but it isn't recognized as "open source" for two years, which hurts adoption and directory listings ([FSL](https://fsl.software/), [AGPL analysis](https://heathermeeker.com/2023/10/13/agpl-in-the-light-of-day/)).

---

## 1. Where we stand

The current build is a **working single-tenant technical MVP**: real `pg_dump`/`mysqldump` runs, scheduling, email, downloads and retention, tested end-to-end, including in the production Docker image. Moving to the target platform means:
- rewriting the data layer (MongoDB → MySQL, one database per tenant);
- rebuilding the frontend in React + TypeScript;
- adding tenancy, billing, notifications, configuration and audit services.

The current dump engine, schedule logic, validation rules and UI design system are reused.

**Market position** (full research in v1, summarized): Databasus (open source, 1.8M+ pulls) leads on features but is self-hosted only and English-only. SimpleBackups ($0–$299/mo) is the closed SaaS benchmark. BackupSheep shut down and SnapShooter narrowed to DigitalOcean only, so vendor-lock fear is real.

**Our angle:**
> Backups you can **prove**, in **any language and timezone**, with **your own storage or ours**, run by a **truly multi-tenant platform where each organization's data lives in its own database**.

---

## 2. Target architecture on AWS

```
                           Route 53 (DNS)
                                │
                  CloudFront ── S3 (React SPA, marketing/docs site)
                                │
                   [Stage B+] Application Load Balancer
                        ┌───────┴────────┐
                   API instance 1   API instance N      (EC2 Auto Scaling Group)
                        │  Express/TS, stateless, SSE
        ┌───────────────┼──────────────────────────────┐
        ▼               ▼                              ▼
   Redis (Valkey)   MySQL server(s)                AWS KMS (envelope keys)
   ─ BullMQ queues  ─ platform DB (tenants, plans,
   ─ pub/sub (SSE)    billing, identities, platform audit)
   ─ rate limits    ─ tenant_<id> DB per tenant (jobs, dumps,
   ─ locks, caches    settings, roles, tenant audit, notifications)
        ▲
        │ jobs
   Worker fleet (EC2 Spot ASG, scales on queue depth)
   ─ pg_dump / mysqldump → gzip → AES-256-GCM → S3 multipart upload
        │
        ├── Managed S3 bucket (per-tenant prefix, SSE-KMS, versioning, lifecycle, optional Object Lock)
        └── Customer's own bucket (BYO: IAM role AssumeRole+ExternalId, or access keys)

   Scheduler (leader-elected via Redis lock) ─ enqueues due runs, respects tenant state
   Notification service ─ outbox → Amazon SES (email) + in-app (MySQL + SSE)
   Lambda (event glue) ─ SES bounce/complaint handling, S3 events, nightly lifecycle sweeps
   EventBridge Scheduler ─ triggers platform-wide sweeps (expiry checks, usage snapshots)
```

### EC2 vs Lambda: which costs less, and for what

| Workload | Best fit | Why |
|---|---|---|
| API + live updates (SSE) | **EC2** | Long-lived connections; Lambda is billed per request/duration and is awkward for SSE |
| Database dumps | **EC2 Spot workers** (Fargate Spot as an alternative) | Dumps can run for hours. Lambda has a **15-minute hard limit** and limited temp disk, and would need the dump tools baked into a container image. Spot is roughly 60–70% cheaper than on-demand |
| Notification sending, SES bounce handling, S3 events, nightly sweeps | **Lambda** | Short, bursty, event-driven. These usually fit inside Lambda's always-free monthly allowance |
| Periodic platform jobs (expiry checks, usage snapshots) | **EventBridge Scheduler → Lambda** | Serverless cron; no need for an always-on box |

**Learning milestone (Phase 5):** benchmark the *same* 1 GB dump on EC2 Spot vs Lambda (container image) vs Fargate Spot. Record cost, time and failure modes, and write it up as a decision record. It's great portfolio material.

### Cost stages (approximate, verify before spending)

| Stage | When | Components | ~Monthly |
|---|---|---|---|
| **A: Launch** | Now → first paying users | 1× EC2 `t4g.small` (Graviton, 2 GB) running Docker Compose (API, worker, scheduler, Redis, MySQL), 30 GB gp3 EBS, public IPv4 (~$3.6), S3, SES, Route 53, CloudWatch basic, KMS (1 key) | **~$18–25** |
| **B: Traction** | Steady traffic / paying tenants | + ALB (~$16+), API ASG (2× t4g.small), worker Spot ASG, RDS MySQL `db.t4g.micro`, ElastiCache/Valkey `t4g.micro` | **~$80–120** |
| **C: Scale** | Enterprise customers | Multi-AZ RDS, dedicated RDS per Enterprise tenant (billed to them), CloudFront + WAF, multi-region (EU / US / India) | Covered by revenue |

**Cost traps we avoid:**
- **NAT Gateway** (~$32/mo): use public subnets with tight security groups, or VPC endpoints.
- **Idle ALB before it's needed.**
- **Secrets Manager per secret:** use SSM Parameter Store (free tier) instead.
- **Surprise egress:** downloads go through presigned URLs, and egress is priced into managed-storage plans.

**Budget alarms:** an AWS Budgets alert at $15 / $25 / $40.

The AWS Free Plan for new accounts (since 15 Jul 2025) gives **$100–$200 in credits valid for 6 months**, not the old 12-month free tier ([AWS terms](https://aws.amazon.com/free/terms), [summary](https://infratally.com/articles/aws-free-tier-2026/)).

### High availability and traffic spikes
- **Stateless API.** Sessions live in signed cookies plus a Redis revocation list, so any instance can serve any request. Redis pub/sub fans SSE events out to whichever instance holds the user's connection.
- **Load balancing.** An ALB with health checks (`/healthz`, `/readyz`) and connection draining. Deploys drain SSE and in-flight requests cleanly.
- **Auto scaling.** API scales on CPU and request count; workers scale on **BullMQ queue depth** (a custom CloudWatch metric).
- **Backpressure.** Per-tenant and per-plan concurrency limits; global limiter in Redis; rate limits per IP, user, tenant and API key.
- **Resilience.** Idempotent jobs with retries and exponential backoff; dead-letter queue; the scheduler uses a leader lock so only one instance enqueues.
- **Spot interruptions.** Workers listen for the 2-minute interruption notice, stop taking jobs and re-queue the current one.

### What Redis is used for
1. **BullMQ job queues:** dumps, restores, verification, notifications, emails. Delayed and repeatable jobs, retries, dead-letter queue.
2. **Pub/sub:** live updates across API instances, plus tenant kill-switch broadcasts to workers.
3. **Distributed locks:** scheduler leader election; "one run per job at a time".
4. **Caches:** tenant status and entitlements, tenant DB routing, permission sets (short TTL, invalidated on change).
5. **Rate limiting:** shared counters across instances.

MySQL remains the source of truth. Redis holds nothing that can't be rebuilt.

---

## 3. Multi-tenancy design (one database per tenant)

### Two kinds of database
- **`platform` database (shared):**
  - tenants, the tenant → database-server registry, plans and entitlements, subscriptions and billing events;
  - global user identities, memberships (a user can belong to several tenants);
  - notification templates, platform broadcasts, platform audit log, usage meters.
- **`tenant_<id>` database (one per tenant):**
  - database connections (encrypted), storage configs (encrypted), jobs, schedules, runs/dumps, restore tests;
  - tenant settings and policies, custom roles, tenant audit log, in-app notifications, notification preferences.

### Isolation in depth
1. **A separate MySQL database per tenant.**
2. **A separate MySQL user per tenant**, granted `ALL ON tenant_<id>.*` only. The app connects to a tenant's database *with that tenant's credentials*, so even an application bug cannot read another tenant's tables.
3. **Tenant context resolved once per request** (from the session's active tenant) and passed explicitly. There is no global "current tenant" variable.
4. **Per-tenant encryption keys:** a KMS-generated data key per tenant (envelope encryption) protects DB credentials, bucket credentials and dump files. Deleting a tenant's key crypto-shreds everything it protected.
5. **Cross-tenant test suite in CI:** every endpoint is called as tenant A against tenant B's IDs, and must return 404/403. **This is a release blocker.**

### Lifecycle
- **Provisioning:** create the database, create the user and grants, run migrations, seed default roles and settings, then register the tenant in `platform`.
- **Migrations:** a runner applies versioned migrations to *every* tenant database in batches, tracks the version per tenant, and can resume after failure.
- **Moving an Enterprise tenant to a dedicated instance:** dump → restore on the new RDS → switch the registry entry → verify → drop the old database. We use our own product to do it.
- **Deletion:** `DROP DATABASE` + drop user + destroy the KMS data key + purge managed-storage objects. This is a clean, provable erasure for GDPR and DPDP.

**Connection management:** an LRU cache of per-tenant connection pools, with small pools and idle eviction. At larger scale, move to RDS Proxy.

---

## 4. Roles and "everything configurable by admin"

### Two admin planes
| Plane | Who | Can do |
|---|---|---|
| **Platform console** | You and future staff (`super_admin`, `support`, `billing_admin`) | Tenants list, suspend/resume (kill switch), plan overrides, custom Enterprise limits, broadcasts, templates, global defaults, usage and revenue. **Support access to tenant data only with time-boxed tenant consent, always audited** |
| **Tenant admin** | Each organization's Owner/Admin | Everything inside their tenant, within the limits of their plan |

### Tenant roles (RBAC)
- **Built-in roles:** **Owner**, **Admin**, **Operator** (run jobs, restore), **Auditor** (read-only + audit export), **Viewer**.
- **Custom roles** (Max/Enterprise): any combination of about 40 granular permissions, e.g. `jobs.create`, `jobs.run`, `dumps.download`, `dumps.restore`, `storage.manage`, `settings.retention.update`, `members.invite`, `audit.export`, `billing.manage`, `notifications.manage`.
- **Enforcement:** permissions are checked server-side on every endpoint; the UI only hides what you can't use.

### Configuration hierarchy (with locks)
```
Platform defaults  →  Plan limits (ceilings)  →  Tenant policy (admin)  →  Job override (if not locked)
```
Example, retention: the platform default is 7 days; the Pro plan allows up to 30 days; the tenant admin sets a default of 14 days and **locks** it, so individual jobs can't change it.

**Configurable by tenant admins** (within plan limits):

| Area | Settings |
|---|---|
| Retention | Days, count, or GFS (daily / weekly / monthly / yearly); deletion safety delay; optional S3 Object Lock (immutable backups) |
| Storage | Managed S3 or BYO bucket (AWS via IAM role + ExternalId *preferred*, or S3-compatible keys for B2/R2/Wasabi/MinIO); region / data residency; path prefix; storage class |
| Schedules | Allowed frequency (plan minimum), default timezone, maintenance windows / blackout periods, max concurrent runs |
| Engines | Which database engines are enabled; default dump options; compression level |
| Security | Password policy, **2FA enforcement**, session timeout, IP allowlist (Enterprise), SSO (Enterprise), who may download or restore, presigned URL lifetime |
| Encryption | Platform-managed keys, or customer passphrase (zero-knowledge) mode |
| Notifications | Tenant-wide defaults, mandatory events, recipients per event, quiet hours |
| Localization | Default language and timezone for new members |
| Branding (Enterprise) | Logo and colors in the app and emails; custom sender name |
| Audit | Audit log retention (plan limit); export schedule |

Every config change is **versioned and audited with a before/after diff** (secrets redacted), and can be **rolled back**.

---

## 5. S3 handling (presigned by default)

- **Downloads:** a presigned GET URL generated per request, **5-minute default TTL** (tenant-configurable within limits), for a single object, with `Content-Disposition` set. Issuance is audited. Files never stream through the API, which saves EC2 bandwidth and CPU.
- **Uploads for restore** (user uploads their own dump): presigned **multipart** PUT URLs, size-capped, with checksum verification.
- **Worker uploads:** multipart via the SDK with worker IAM role credentials (managed storage) or the tenant's assumed role or keys (BYO), with a `x-amz-checksum-sha256` checksum.
- **Managed bucket hardening:**
  - Block Public Access; SSE-KMS encryption; versioning.
  - Lifecycle rules that mirror retention; optional **Object Lock** for ransomware-proof backups.
  - Per-tenant prefix `tenants/<tenantId>/…`, enforced by the code that generates presigned URLs.
- **BYO validation:** on save, a probe write/read/delete confirms permissions. We recommend a minimal IAM policy and show copy-paste templates.
- **Egress awareness:** downloads from managed storage cost AWS egress (~$0.09/GB after the free allowance). Managed-storage plans include a download allowance; overage is metered.

---

## 6. Billing, entitlements and the tenant kill switch

### Plans (draft, to be validated with users)
| | **Free** | **Pro** | **Max** | **Enterprise** | **Self-hosted** |
|---|---|---|---|---|---|
| Price (draft) | $0 | ~$12/mo | ~$39/mo | Custom (contact) | Community: free · EE license: per instance/yr |
| Databases | 2 | 10 | 50 | Custom | Unlimited |
| Min. schedule | Daily | Hourly | 15 min | Custom | Any |
| Retention max | 7 days | 30 days | 90 days + GFS | Custom | Any |
| Storage | BYO or 1 GB managed | BYO or managed (per-GB) | BYO or managed (per-GB) | BYO / managed / dedicated | Own |
| Members | 1 | 5 | 25 | Unlimited | Unlimited |
| Roles | Built-in | Built-in | **Custom roles** | Custom + SSO/SCIM | EE: custom |
| Audit log | 7 days | 90 days | 1 yr + export | Custom + stream | EE |
| Restore verification | – | Weekly | Daily + drills | Custom | EE |
| Tenant DB | Shared server | Shared | Shared | **Dedicated instance option** | Own |

Managed storage is billed per GB-month plus an egress allowance, priced above raw S3 cost (~$0.023/GB) to cover KMS, requests and egress.

### Entitlement engine
- **Our database is the source of truth** for what a tenant may do (plan + overrides + add-ons → computed entitlements, cached in Redis).
- **Payment provider behind an interface** (`BillingProvider`): a test-mode provider now. Later, pick from:
  - a **Merchant of Record** (Paddle / Lemon Squeezy), which files global VAT/GST for you;
  - **Stripe**;
  - **Razorpay** (India), once a business is registered.

  Provider webhooks only *update subscription state*, and they are verified and idempotent.
- **Usage metering:** database count, runs, managed storage GB (daily snapshot), egress, members. Shown in the UI with "80% of limit" warnings.
- **Downgrades:** if a tenant is over the new limits, the admin chooses which jobs stay active; the rest are paused, never silently deleted.

### Subscription lifecycle
```
trialing → active → (payment fails) past_due → grace (7 days) → suspended → pending_deletion → deleted
                ↘ expiring reminders: 14 / 7 / 3 / 1 days        ↑ read-only 30 days, notices at 30/7/1 days
```
- **Suspended:**
  - schedulers skip the tenant; workers refuse and abort its jobs;
  - write APIs are blocked; sign-in still works to **pay or download existing backups** (presigned) during the 30-day read-only window.
- **Deleted:** tenant database dropped, keys shredded, managed objects purged. For **BYO buckets we never delete the customer's own files**; we only drop our copy of the credentials.
- **Reactivation** at any point before deletion restores everything instantly.

### Kill switch: four independent layers
It is triggered automatically by the lifecycle, or manually by a platform admin (abuse, Terms violation, legal request).
1. **Scheduler:** never enqueues runs for non-active tenants.
2. **Queue/worker:** every job re-checks tenant state before starting. A Redis pub/sub `tenant.suspended` message aborts in-flight jobs within seconds.
3. **API middleware:** blocks mutating endpoints and new presigned URLs (except the read-only window).
4. **Credentials:** the tenant's MySQL user is locked (`ALTER USER … ACCOUNT LOCK`), so even a bug can't touch its data.

Every switch-off and switch-on is audited with who, why and when, and tested by an automated chaos test in CI.

---

## 7. Notification service

- **Architecture:** domain events are written to an **outbox table** in the same transaction as the change, so nothing is lost. A dispatcher publishes them to BullMQ; channel workers deliver them.
  - **Email:** Amazon SES, ~$0.10 per 1,000 emails.
  - **In-app:** a bell with unread count, stored in the tenant DB and pushed live via SSE.
  - **Later:** Slack, Teams, webhooks and SMS plug into the same pipeline.
- **Event catalog:**

  | Category | Events |
  |---|---|
  | Backups | Succeeded, failed, **missed** (dead-man's switch), restore-verified, storage credentials invalid |
  | Billing (mandatory) | Trial ending, plan expiring (14/7/3/1 days), payment failed, grace started, suspended, deletion scheduled, reactivated |
  | Onboarding | Welcome, day-1 "connect your first database", day-3 tips, first successful backup 🎉 |
  | Security (mandatory) | New sign-in, 2FA changed, role changed, member invited or removed, API key created |
  | Platform | Announcements, maintenance windows, policy updates |

- **Preferences:** per user × category × channel. Tenant admins set defaults and can force some on. **Security and billing events are transactional and can't be turned off. Marketing/onboarding tips are opt-in with one-click unsubscribe** (GDPR, CAN-SPAM, India). Quiet hours and daily digest use the *user's* timezone.
- **Templates:** versioned, per language (en, hi, …), with ICU formatting. Platform admins edit them in the console and preview them with sample data.
- **Broadcasts:** platform admins target by plan, region, tenant or language, schedule sends, and see delivery stats.
- **Deliverability:** SES bounce/complaint notifications (SNS → Lambda) feed a suppression list. SPF/DKIM/DMARC are set up on your domain. The domain is the one small purchase needed early.
- **Reliability:** idempotency keys (no duplicates), retries with backoff, dead-letter queue, a delivery log per notification.

---

## 8. Audit logs of everything

- **Two logs:**
  - a **platform audit** of staff actions: tenant suspensions, plan overrides, support access, template changes;
  - a **tenant audit** (in the tenant DB): everything users and the system do inside the tenant.
- **What is logged:**
  - authentication (success/fail, 2FA, sessions), membership and roles;
  - every config change (before/after diff, secrets redacted), job create/update/delete;
  - run start/end, **presigned download issuance**, restores, verification results;
  - storage credential changes, notification sends, billing and state changes, API key usage, kill-switch events.
- **Record format:** actor (user / system / platform staff), tenant, IP, user agent, request ID, timestamp (UTC), action, target, outcome.
- **Tamper evidence:** each record includes the hash of the previous one (a hash chain per tenant). A daily digest is written to an S3 bucket with **Object Lock (WORM)**, so any edit to history is detectable.
- **Access:** a searchable and filterable UI, CSV/JSON export, retention per plan, and SIEM streaming via webhook/S3 for Enterprise.
- **Privacy:** audit logs contain personal data (IP, email), so they have defined retention and are included in data-export requests.

---

## 9. Compliance (the gate every feature must pass)

New obligations introduced by this version, on top of v1 (GDPR, DPDP, CCPA, EU CRA, cookies, accessibility, license compliance):

| Obligation | Why it applies now | How we meet it |
|---|---|---|
| **Processor duties (GDPR Art. 28, DPDP)** | Managed storage means we hold customer dump data | DPA, public sub-processor list (AWS, SES, payment provider), 24–72h breach notice to tenants, region choice (Mumbai `ap-south-1`, Frankfurt `eu-central-1`, N. Virginia `us-east-1`) |
| **International transfers** | Global users | EU data stays in the EU region when chosen; SCCs where needed; DPDP permits transfers except to countries the government restricts |
| **Retention and erasure** | Plan expiry and deletion | Written retention schedule, notices before deletion, provable erasure (DROP + key shred), deletion certificate |
| **Marketing consent** | Onboarding and promotional emails | Opt-in, unsubscribe, preference center |
| **Staff access** | Platform console | Least privilege, 2FA mandatory, consented and time-boxed support access, audited |
| **Security of processing** | Credentials and dumps | KMS envelope encryption, TLS everywhere, secrets in SSM, no credentials in logs, pen-test before paid launch |
| **EU CRA** | Selling software in the EU | `SECURITY.md`, 24h/72h vulnerability reporting runbook, SBOM on every release ([EU Commission](https://digital-strategy.ec.europa.eu/en/policies/cra-reporting)) |
| **DPDP Act deadline** | Indian users | Full compliance by **13 May 2027**; penalties up to ₹250 crore ([PIB](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf)) |
| **Tax** | Paid plans | Merchant of Record, or registered GST/VAT handling, before charging |

**Rule:** a feature that can't pass the gate (data map, privacy by design, security review, CI security checks, accessibility, i18n, audit coverage, cross-tenant tests) is **removed, not shipped**.

---

## 10. Tech stack (final)

| Layer | Choice |
|---|---|
| Frontend | **React + TypeScript + Vite**; TanStack Router + Query; react-i18next (ICU); Radix-based accessible components with our existing design tokens; Motion for animations |
| API | Node 22 + **TypeScript**, Express 5, zod (schemas shared with the frontend) |
| App DB | **MySQL 8.4 LTS**; **Drizzle ORM** (typed MySQL, migrations) with a custom per-tenant migration runner |
| Queue / cache | **Redis (Valkey) + BullMQ** |
| Workers | Node/TS spawning `pg_dump`/`mysqldump`/`mariadb-dump` (Go agent later) |
| AWS | EC2 (Graviton), ALB + ASG, RDS MySQL, ElastiCache, S3, KMS, SES, Lambda, EventBridge Scheduler, CloudWatch, SSM Parameter Store, Route 53, CloudFront |
| Infra as code | **AWS CDK in TypeScript** (same language as the app); GitHub Actions deploying via **OIDC** (no stored AWS keys) |
| Monorepo | pnpm + Turborepo: `apps/web`, `apps/api`, `apps/worker`, `apps/platform-console`, `packages/shared`, `infra/`, `ee/` |
| Testing | Vitest, Playwright E2E, Testcontainers (MySQL 5.7/8.0/8.4, MariaDB 10/11, PG 12–18), **cross-tenant isolation suite**, kill-switch chaos tests, axe, k6 load tests |
| Supply chain | CodeQL, Dependabot, gitleaks, Trivy, Syft SBOM, license allow-list, cosign-signed images |
| Observability | CloudWatch logs and metrics, OpenTelemetry traces, error tracking with PII scrubbing, public status page |
| Self-hosted edition | The same code in single-tenant mode (one tenant auto-provisioned); EE features unlocked by an **offline-verifiable signed license key** |

---

## 11. Phased roadmap

Every phase repeats **research → build → QA → compliance gate → release → measure → retro**, and re-scans competitors before the next phase starts.

Estimates are in hours. At **8 h/week, 1 week ≈ 8 h**; at 16 h/week, halve the weeks.

| Phase | Scope | Hours | Weeks @8h | Weeks @16h |
|---|---|---|---|---|
| **0. Foundations** | Name + trademark/domain check; monorepo TS; CI security pipeline; AGPL + `ee/` + CLA; legal drafts (Privacy, Terms, AUP, DPA); threat model; **AWS account hardening** (root MFA, budgets/alarms, OIDC deploy role); CDK skeleton | 30 | ~4 | ~2 |
| **1. Multi-tenant core (MVP v1)** | `platform` DB + per-tenant DB/user provisioning; tenant routing and migration runner; sign-up/verify/reset/**2FA**; memberships and tenant switcher; **built-in RBAC**; port jobs/dumps/scheduler to MySQL + BullMQ; React app shell + i18n (en/hi) + per-user timezone; **managed S3 + BYO** with **presigned downloads**; KMS envelope encryption; **audit log v1** (hash chain); cross-tenant test suite; deploy **Stage A** on EC2 | 110 | ~14 | ~7 |
| **2. Billing, entitlements, kill switch** | Plan catalog and limits; entitlement engine + Redis cache; `BillingProvider` with test mode; usage metering; lifecycle state machine; **4-layer kill switch** + chaos test; **platform console v1** (tenants, suspend/resume, overrides) | 60 | ~8 | ~4 |
| **3. Notification service** | Outbox + dispatcher; SES email + in-app bell (SSE via Redis); preferences (user/tenant/mandatory); localized templates; onboarding and expiry sequences; broadcasts; **SES bounces via SNS → Lambda** (first Lambda) | 45 | ~6 | ~3 |
| **4. Admin configurability** | Configuration hierarchy with locks; **custom roles** + permission matrix UI; retention policies (days/count/GFS) + S3 lifecycle and Object Lock; security policies (2FA enforcement, sessions, IP allowlist); config versioning with diff and rollback; audit UI + export | 55 | ~7 | ~3.5 |
| **5. Scale and AWS depth** | Stage B infrastructure via CDK: ALB + API ASG, worker Spot ASG scaling on queue depth, RDS MySQL, ElastiCache; graceful draining; k6 spike tests; **EC2 vs Lambda vs Fargate benchmark** + decision record | 45 | ~6 | ~3 |
| **6. Proof of recovery** | One-click restore; automated restore verification in throwaway containers; recovery drills (RTO/RPO); missed-backup alerts; evidence-pack PDF | 55 | ~7 | ~3.5 |
| **7. Launch readiness** | Pick payment provider (after entity decision); lawyer review; DPA and sub-processor pages; docs and marketing site (Astro, multi-language); status page; pen-test; launch (Show HN, Product Hunt, r/selfhosted) | 40 | ~5 | ~2.5 |
| **8+. Growth** | Go agent (outbound-only, in customer networks); more engines (Mongo, SQL Server, SQLite, Redis); SSO/SCIM; PII-masked staging refresh; Slack/Teams/webhooks; more languages + RTL; SOC 2 readiness | ongoing | | |

- **Launchable multi-tenant MVP** (Phases 0–3): about **245 h**, which is **~7.5 months at 8 h/week or ~4 months at 16 h/week**.
- **Full platform through launch** (Phases 0–7): about **440 h**, which is **~13 months at 8 h/week or ~7 months at 16 h/week**.

Please treat these as honest estimates. A smaller MVP cut is possible if you want to launch sooner.

### Definition of done (every phase)
- Unit, E2E and cross-tenant suites green; CI security gates green; SBOM published.
- i18n: no hard-coded strings; en + hi complete.
- Audit coverage for every new action; data map updated.
- Deployed to AWS via CDK; cost checked against budget.
- Retro note: what we learned, competitor changes, what to adjust next.

---

## 12. Name shortlist (quick-screened; a formal trademark and domain check comes in Phase 0)

You asked for more interesting names. Quick web screening already ruled out Kintsugi (tax-compliance SaaS), Lifeboat (existing DB backup tool), Snapback / Boomerang (existing backup/recovery products), Stowaway (known malware name), Svalbard (Google backup project), Ambry (LinkedIn object store), DataCove and Stash.

| Name | Tagline | Story | Screen result |
|---|---|---|---|
| **Coffer** | *"The strongbox for your databases."* | A coffer is where valuables are locked away. Short, premium, easy in any language | No backup-software conflict found |
| **Mothball** | *"Pack it away. Bring it back perfect."* | "Mothballing" means storing something safely for later. Playful and memorable | No backup-software conflict found |
| **Dumpling** | *"Wrap up your data. Serve it back anytime."* | Fun, and nods to the project's roots as a dumping tool | Not yet screened |
| **Hoardly** | *"Hoard every byte. Restore in one click."* | Coined word, so easier to trademark | Not yet screened |

Pick one or two, or tell me the feeling you want (serious/enterprise, playful/dev-friendly, technical), and I'll generate more in that direction.

---

## 13. Open items
1. ~~Name~~: **DBRB** chosen. Brand guide, logo and handle checks are in [BRAND.md](BRAND.md). Buy `dbrb.dev` (+ optional `dbrb.in`) and create the GitHub org `dbrbhq` at the start of Phase 0.
2. ~~Domain~~: approved; buy it once the name is final.
3. ~~AWS region~~: Mumbai (`ap-south-1`). Low latency for you, and it covers India data residency. EU and US regions are added in Stage C.
