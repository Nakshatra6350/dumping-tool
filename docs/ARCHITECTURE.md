# How DBRB is built

This document explains how the parts of DBRB fit together and why they are built that way.
It describes what exists at the end of milestone 1. Section 9 sketches what milestone 2
adds, and is marked as a plan.

Words used here:

- **Workspace** (in code: *tenant*): one organisation using DBRB. Its data is separate
  from every other workspace.
- **Platform owner**: the person who runs the DBRB installation. The first account
  created is the platform owner.
- **Platform database**: the one shared database that knows which workspaces and
  accounts exist.

## 1. The shape of the system

```
 Browser
    │  one address in every environment (cookies and security checks behave the same)
    ▼
 apps/web     React app. In development Vite serves it and forwards /api to the API.
    │         In a single-container deployment the API serves the built files.
    ▼
 apps/api     Express. Thin: reads the session, checks the permission, validates
    │         the input, calls core, shapes the reply.
    ▼
 packages/core   Everything DBRB knows how to do. No HTTP in here, so workers and
    │            command-line tools use exactly the same code as the API.
    ├── MySQL    platform database  +  one database per workspace
    ├── Redis    rate-limit counters (queues and live updates in milestone 2)
    ├── Storage  local disk or S3, behind one interface
    └── Mail     SMTP (Mailpit locally)

 packages/shared   Types, validation rules and the list of settings, imported by
                   both the API and the web app so they cannot drift apart.
```

`createCore(config)` in [`packages/core/src/core.ts`](../packages/core/src/core.ts) builds
every service once and wires them together. The API builds one core at start-up; tests
build their own against a throwaway database.

## 2. Workspaces and isolation

There are two kinds of database.

| | Platform database | Workspace database |
|---|---|---|
| How many | One | One per workspace |
| Holds | Accounts, the list of workspaces, memberships, sessions, the platform owner's rules, the platform activity record | That workspace's settings, storage targets and activity record. From milestone 2: connections, jobs, backups, restores |
| Reached as | The application's own MySQL user | A MySQL user that belongs to that workspace alone |

The second row of the "reached as" column is the important part. When someone signs up,
[`TenantService.provision`](../packages/core/src/tenancy/tenants.ts) does this:

1. Creates a database named `dbrb_t_<id>`.
2. Creates a MySQL user `t_<id>` with a random password.
3. Grants that user access to that one database and nothing else.
4. Stores the password and a new random encryption key, both encrypted, in the platform
   database.
5. Applies the workspace schema and starts its activity record.

If any step fails, everything created so far is removed.

From then on, DBRB reads and writes a workspace's data **signed in to MySQL as that
workspace's user**. A bug that builds the wrong query cannot leak another workspace's
data, because MySQL refuses the query. The integration tests prove this by trying to
read, write, drop and even list another workspace's database and expecting MySQL's
"access denied".

Two details that are easy to get wrong:

- In a MySQL `GRANT`, `_` in a database name is a wildcard. The name is escaped, so a grant
  on `dbrb_t_abc` cannot also match `dbrbxtxabc`.
- Connection pools are kept per workspace and closed when idle, so a thousand workspaces
  do not mean a thousand open pools.

Deleting a workspace drops its database and its MySQL user and removes its row, which
holds the only copy of its encryption key. Whatever that key protected can no longer be
read by anyone.

## 3. Secrets and encryption

```
 MASTER_KEY (environment)            the only secret that lives outside the database
      │  wraps
      ▼
 workspace data key (random, 32 bytes)   stored wrapped, one per workspace
      │  encrypts
      ▼
 that workspace's secrets: its S3 keys today; database passwords from milestone 2
```

- Encryption is AES-256-GCM. Each value is also bound to a *context* (which workspace,
  which record), so an encrypted value copied onto a different record fails to decrypt.
- The component that holds the master key is the `KeyProvider`
  ([`crypto/keys.ts`](../packages/core/src/crypto/keys.ts)). Today it reads `MASTER_KEY`
  from the environment. At deploy time an AWS KMS version replaces it; nothing that calls
  it changes.
- Passwords are hashed with scrypt, never stored. A password hashed with an older, weaker
  setting is re-hashed the next time its owner signs in.
- Secrets are never written to the activity record or the logs. The record for a saved
  bucket contains where the bucket is, not its keys. The web app is only ever sent the
  last few characters of an access key ID.

**Losing `MASTER_KEY` means losing every stored secret.** Back it up.

## 4. Two kinds of configuration

| | Where it lives | Who changes it | Example |
|---|---|---|---|
| What the server needs in order to start | Environment variables | Whoever deploys DBRB | Database address, master key, ports |
| How the product behaves | The database, edited in the admin panel | The platform owner and workspace admins | Where backups are stored, S3 bucket details, whether sign-ups are open |

Storage is in the second group on purpose. Switching a workspace from local disk to S3
is a click in the panel, takes effect immediately, is recorded, and needs no restart.

Product settings are layered. For any setting, the first of these that has a value wins:

1. **Pinned for one workspace** by the platform owner. The workspace cannot change it.
2. **Chosen by the workspace**, if the setting is one workspaces may change.
3. **Platform default**, set by the platform owner.
4. **Built-in default**, from the code.

Every setting is declared once, in
[`packages/shared/src/settings.ts`](../packages/shared/src/settings.ts), with its type,
allowed values and default. The API validates against that list and the web app renders
from it. [CONFIGURATION.md](CONFIGURATION.md) lists them all and shows how to add one.

## 5. Storage

### One interface, two implementations

Everything that stores or fetches a backup goes through `StorageDriver`
([`storage/types.ts`](../packages/core/src/storage/types.ts)): `put`, `read`, `exists`,
`delete` and `signedDownloadUrl`. There is a driver for local disk and one for S3. The
S3 driver works with Amazon S3 and with S3-compatible services (Backblaze B2, Cloudflare
R2, MinIO, RustFS). Uploads are streamed in parts, so a large backup is never held in
memory.

### Three modes

| Mode | Backups go to | Set up by |
|---|---|---|
| `local` | The DBRB server's disk | Nobody. Always available |
| `platform_s3` | An S3 bucket run by the platform | The platform owner |
| `own_s3` | An S3 bucket the workspace owns | That workspace's admin |

### Who decides

The platform owner sets a default mode and which modes workspaces may choose, and can pin
one workspace to a mode. Each workspace's admin chooses among the allowed modes. The mode
in effect is worked out like this:

1. If the workspace is pinned, the pinned mode.
2. Otherwise the workspace's own choice, if it is still allowed and still working.
3. Otherwise the platform default.
4. If none of those is usable, local disk, and the workspace is told why.

The web app shows which of these applied, so nobody has to guess why their backups go
where they go.

### A bucket is tested before it is saved

Saving S3 details runs four checks against the real bucket: write a file, read it back,
download it through a signed link, delete it. The details are saved only if all four
pass, and the person sees each step and, on failure, the reason in plain words ("The
secret access key is incorrect"). The same test can be re-run at any time.

### Switching never strands a backup

Writing an object returns its exact location: which scope (platform or workspace), which
kind (local or S3), which saved bucket, and its key. Reading always goes by that recorded
location, never by "wherever storage points today". From milestone 2 the location is
saved with each backup, so changing the mode, or pointing at a different bucket, affects
new backups only. A bucket that is replaced is marked *retired* rather than deleted, so
objects written to it earlier can still be read and downloaded. The integration tests
write an object, switch storage, and read the object back.

### Downloads

A download is always a time-limited signed link that needs no session:

- For S3 it is a presigned URL, so the file goes from the bucket straight to the browser
  and never passes through DBRB.
- For local disk it is a link signed by DBRB (`SIGNING_KEY`) and served by the API.

Both expire. The lifetime is a setting (1 minute to 1 hour, 5 minutes by default).

### Protecting the server from the addresses people type in

A workspace admin types an S3 endpoint and the server then connects to it. On a shared
deployment that must not be usable to reach the server's own network, so an endpoint
that resolves to a private, loopback or link-local address is refused, and `https` is
required. Local development and self-hosting legitimately use private addresses, so the
check is relaxed there (`ALLOW_PRIVATE_NETWORK_TARGETS`).

## 6. The activity record

Every change is written to an append-only log. There is one for the platform and one
inside each workspace, with the same structure.

Each entry stores a hash of *itself plus the previous entry's hash*. Change one field of
one old entry and its hash no longer matches; delete an entry and the chain has a gap;
insert one and the hashes after it are wrong. `verify` walks the chain and reports the
first entry where it breaks. The web app shows the result on the Activity page.

Details that matter:

- Entries are numbered. Writing one locks a single "head" row, so two requests at the
  same moment cannot both claim the same number.
- The hash is computed over a canonical form of the entry (keys sorted at every level),
  because MySQL reorders keys inside JSON.
- An entry records who (a person, the system, or the platform owner), from which address,
  in which request, what they did, and to what.
- Exporting the record is itself recorded.

What this does not yet do: the chain's latest hash is not published anywhere outside the
database, so someone with full control of the database could rebuild the whole chain. The
plan covers this with a daily digest written to write-once storage.

## 7. Accounts and access

- **Sessions.** Signing in creates a random token. The browser gets it in a cookie that
  scripts cannot read (`HttpOnly`) and that other sites cannot send (`SameSite=Lax`). The
  database stores only a hash of it, so a copy of the database contains no usable
  sessions. Changing a password signs out every other device.
- **Requests from other sites.** A browser request that changes something is refused
  unless its `Origin` header is DBRB's own address. Together with the cookie rule above,
  another website cannot act as a signed-in person.
- **Guessing.** Sign-in, sign-up, bucket tests and downloads are rate limited. The counters
  are in Redis so they hold across several API servers, and fall back to memory if Redis
  is down rather than switching off.
- **Not revealing who has an account.** A wrong password and an unknown email produce the
  same reply and take about the same time.
- **Roles.** Owner, admin, operator, auditor and viewer. Each is a fixed list of
  permissions in [`packages/shared/src/permissions.ts`](../packages/shared/src/permissions.ts).
  The API checks the permission on every route. The web app hides what a person cannot
  do, but that is a courtesy, not the protection.
- **The platform owner** is the first account, plus any address listed in
  `PLATFORM_ADMIN_EMAILS`. The platform section of the API is closed to everyone else.
- **Browser hardening.** Responses carry a content security policy that only allows
  scripts, styles, fonts and connections from DBRB's own address. Fonts are bundled with
  the app rather than loaded from a font service, so no third party learns of a visit.

## 8. The web app

- **Structure.** One folder per feature under `apps/web/src/features`. Shared building
  blocks (buttons, fields, cards) are in `components/ui.tsx`.
- **Routing.** Routes have guards: signed-out pages redirect a signed-in person, the app
  redirects a signed-out one, and the platform section redirects anyone who is not the
  platform owner. A page that fails gets an error screen without taking the menu down
  with it; an unknown address gets a "not found" page; and if the server cannot be
  reached the app says so instead of pretending nobody is signed in.
- **Languages.** English is the source. Every other language must have exactly the same
  keys, which the compiler enforces. A test checks what the compiler cannot see: that
  each translation fills in the same values as the English text.
- **Time.** Stored in UTC, shown in the reader's timezone and language.
- **Appearance.** The colours and components come from the design tokens in
  `styles/app.css`. See [BRAND.md](BRAND.md). Dark and light themes, and layouts that
  work from a phone up.

## 9. What milestone 2 adds (plan)

Nothing in this section is built yet.

**Backup engines as plug-ins.** PostgreSQL and MySQL come first. MongoDB, SQL Server,
SQLite, Redis, Cassandra and ClickHouse follow. They do not all back up the same way, so
the engine interface is designed around three shapes of output rather than assuming a
single dump file:

| Shape | Example | What the engine hands over |
|---|---|---|
| One stream | `pg_dump`, `mysqldump`, `mongodump --archive` | A stream, which DBRB compresses and stores |
| Several files | Cassandra snapshots, a Redis RDB plus AOF | A list of files, stored as one backup with a manifest |
| Straight to storage | ClickHouse `BACKUP ... TO S3`, SQL Server `BACKUP TO URL` | The database writes to the bucket itself; DBRB records what was written |

Each engine will declare what it needs to connect (which drives the form in the web
app), how to test a connection, how to list databases, how to back up and how to
restore. Adding an engine should mean adding one folder and one line in a registry, with
no change to storage, scheduling, downloads or the web app. The storage layer above was
written with this in mind: it knows nothing about databases.

**Also in milestone 2:** a job queue and workers (so backups run outside the API), a
scheduler, downloads through the signed links described above, and restore.

**Milestone 3:** dashboard, notifications, team members and invitations, and a wider
activity view.

**Deployment** comes after that. The local services map one-to-one onto AWS (see the
table in the [README](../README.md)), which is why nothing in the code is specific to
running locally.

## 10. How it is tested

| Kind | What it covers | Needs |
|---|---|---|
| Unit | Encryption, hashing, settings rules, local storage, date and timezone helpers, translation completeness | Nothing |
| Integration (core) | Workspace isolation at the MySQL level, tamper detection, layered settings, storage switching and old objects staying readable, presigned links, accounts, the reset tool | The local Docker services |
| Integration (API) | Cookies, cross-site refusal, permissions, the platform section, signed local downloads, CSV export, rate limiting | The local Docker services |

Each integration test file creates its own platform database and workspace prefix and
removes them afterwards, so tests never touch development data. Linting includes a rule
that catches a forgotten `await`, because in a backup tool that means work reported as
done that is not.

## 11. Known limits at this milestone

- No email verification, password reset or two-factor sign-in yet.
- Sign-in attempts are limited per network address, not yet per account.
- One person belongs to one workspace; invitations and switching workspaces are not built.
- The private-address check on S3 endpoints resolves the name once, when the details are
  saved. It needs to be tied to the connection itself before DBRB is offered as a shared
  hosted service.
- The activity record's latest hash is not yet anchored outside the database (see
  section 6).
- The master key comes from the environment. AWS KMS replaces it at deploy time.
