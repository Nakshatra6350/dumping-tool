# Configuring DBRB

DBRB is configured in two places, and it matters which is which.

| | Environment variables | Settings in the admin panel |
|---|---|---|
| What they are for | What the server needs in order to **start** | How the product **behaves** |
| Stored in | The `.env` file, or the host's environment | The database |
| Changed by | Whoever deploys DBRB | The platform owner and workspace admins |
| Takes effect | After a restart | Immediately |
| Recorded in the activity record | No | Yes, with who changed what from what to what |

**Where backups are stored, and every S3 detail, is a setting in the admin panel.** There
is no environment variable that switches storage. The only storage-related environment
variable is the folder used by the local-disk option.

## 1. Environment variables

Copy `.env.example` to `.env`. In development every variable has a working default, so
an empty `.env` runs.

### Addresses

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `APP_URL` | `http://localhost:5173` | Public address of the web app. Used in emails and to decide which site may send requests |
| `API_URL` | `http://localhost:4000` | Public address of the API. Used to build download links for local-disk storage |
| `API_PORT` | `4000` | Port the API listens on |

### Database and Redis

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | Local Docker MySQL | The platform database. This MySQL user must be able to create databases and users, because every workspace gets its own |
| `DATABASE_ADMIN_URL` | Same as `DATABASE_URL` | Optional. A more privileged connection used only for creating and deleting workspace databases, so the everyday connection can have fewer rights |
| `TENANT_DB_PREFIX` | `dbrb_t_` | Each workspace database is named with this prefix followed by the workspace's ID |
| `REDIS_URL` | `redis://127.0.0.1:6380` | Redis or Valkey |
| `AUTO_MIGRATE` | On, except in production | Apply database changes at start-up. In production run `pnpm db:migrate` as a deploy step instead |

### Keys

| Variable | Default | Meaning |
|---|---|---|
| `MASTER_KEY` | A fixed development value | Protects every stored secret. **Required in production**, 32 characters or more. If it is lost, workspace databases and saved S3 keys can no longer be opened. Back it up somewhere separate from the database |
| `SIGNING_KEY` | A fixed development value | Signs download links for local-disk storage. **Required in production**, 32 characters or more. Changing it invalidates links already issued, nothing else |

Generate a key with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The server refuses to start in production without both keys.

### Accounts

| Variable | Default | Meaning |
|---|---|---|
| `SESSION_TTL_DAYS` | `7` | How long a sign-in lasts (1 to 90) |
| `PLATFORM_ADMIN_EMAILS` | Empty | Comma-separated email addresses that are platform owners. The first account created always is, so this is only needed to add more |
| `PASSWORD_HASH_COST` | `17` | Work factor for password hashing, as a power of two. Leave it alone unless you have measured |

### Storage and network

| Variable | Default | Meaning |
|---|---|---|
| `STORAGE_LOCAL_DIR` | `./data/storage` | Folder used by the local-disk storage option. Relative paths start at the project root |
| `ALLOW_PRIVATE_NETWORK_TARGETS` | On, except in production | Whether addresses typed in by workspace admins (S3 endpoints today) may point at private or internal addresses. **Keep it off on a shared, hosted deployment.** Turn it on when self-hosting next to your own MinIO or similar |

### Email

| Variable | Default | Meaning |
|---|---|---|
| `MAIL_DRIVER` | `console` | `console` only logs the message, so nothing is sent by accident. `smtp` sends |
| `SMTP_HOST`, `SMTP_PORT` | `127.0.0.1`, `1025` | The SMTP server. The defaults are the local Mailpit |
| `SMTP_SECURE` | `false` | Use TLS from the start of the connection |
| `SMTP_USER`, `SMTP_PASS` | Empty | Credentials, if the server needs them |
| `MAIL_FROM` | `DBRB <no-reply@dbrb.local>` | The sender shown on emails |

### Diagnostics

| Variable | Default | Meaning |
|---|---|---|
| `LOG_LEVEL` | `debug` in development, `info` in production | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |
| `DBRB_MIGRATIONS_DIR` | Inside `packages/core` | Where the migration files are, if they have been moved in a packaged deployment |

## 2. Settings in the admin panel

Every setting is declared once in
[`packages/shared/src/settings.ts`](../packages/shared/src/settings.ts).

| Setting | Values | Default | Who may change it |
|---|---|---|---|
| `storage.mode` | `local`, `platform_s3`, `own_s3` | `local` | Platform owner sets the default. Each workspace may choose its own, within the allowed options |
| `storage.allowed_modes` | Any of the three | All three | Platform owner only |
| `storage.download_url_ttl_seconds` | 60 to 3600 | 300 | Platform owner sets the default. Each workspace may choose its own |
| `signup.enabled` | on, off | on | Platform owner only. There is no screen for it yet; it can be changed through the API (`PUT /api/v1/platform/settings/signup.enabled`). The first account can always be created |

### How a value is decided

For each setting, the first of these that has a value wins:

1. **Pinned for one workspace** by the platform owner. The workspace sees the value and
   that it is locked, and cannot change it.
2. **Chosen by the workspace**, if workspaces are allowed to change that setting.
3. **Platform default**, set by the platform owner.
4. **Built-in default**, from the table above.

## 3. Storage, step by step

### As the platform owner: *Platform → Storage rules*

- **Default storage.** Used by every workspace that has not chosen for itself. "Platform
  S3" can only be picked once the platform bucket below is set up and has passed its test.
- **Workspaces may choose.** Switch an option off and no workspace can select it. A
  workspace that had chosen it moves to the default, and is told why. The default option
  is always allowed.
- **Platform S3 bucket.** The bucket used by the "Platform S3" option. Type in the
  details and press *Test and save*. DBRB writes a file, reads it back, downloads it
  through a signed link and deletes it. The details are saved only if all four steps
  pass.
- **Local disk.** Shows the folder in use and lets you run the same four-step test on it.
- **Workspaces.** Where each workspace's backups go and who decided. *Pin to* forces one
  workspace onto an option; *Not pinned* gives the choice back.

### As a workspace admin: *Settings → Storage*

- The banner at the top shows where new backups go and why (your choice, the platform
  default, or locked by the platform owner).
- Pick one of the available options. An option that cannot be picked says why.
- **Your own S3 bucket.** Connect it with *Test and save*, as above. Works with Amazon S3
  and S3-compatible services. Leave *Endpoint* empty for Amazon S3.
- **Download links.** How long a download link stays valid.

Keys are encrypted before they are saved and are never shown again. To change other
details and keep the keys, leave both key fields empty.

Switching only affects new backups. Anything stored earlier stays where it is and remains
downloadable.

### Trying S3 locally

`pnpm infra:up` starts an S3-compatible server and creates two buckets. Use these details
in the panel:

| Field | Platform bucket | A workspace's own bucket |
|---|---|---|
| Bucket name | `dbrb-platform` | `dbrb-tenant-demo` |
| Region | `us-east-1` | `us-east-1` |
| Endpoint | `http://127.0.0.1:9000` | `http://127.0.0.1:9000` |
| Path-style addresses | On | On |
| Access key ID | `dbrb_s3_dev` | `dbrb_s3_dev` |
| Secret access key | `dbrb_s3_dev_secret` | `dbrb_s3_dev_secret` |

These keys exist only for the local server and are defined in
[`infra/docker-compose.dev.yml`](../infra/docker-compose.dev.yml). You can browse the
buckets at <http://localhost:9001>.

### A minimal permission set for a real bucket

Give DBRB an access key that can only do what it needs, on one bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
      "Resource": "arn:aws:s3:::YOUR-BUCKET/*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::YOUR-BUCKET"
    }
  ]
}
```

## 4. Adding a setting

1. Add an entry to `SETTING_DEFINITIONS` in `packages/shared/src/settings.ts`: its type,
   allowed values, default, and whether workspaces may change it.
2. Read it where it is needed with `core.settings.resolve(tenant, "your.key")`. The value
   comes back already layered, with its source and whether it is locked.
3. Add its name to `activity.settingNames` in both language files, so changes to it read
   well in the activity record. A test fails if you forget.

Validation, storage, layering, pinning, the API and the activity record need no change.

## 5. Starting again locally

```bash
pnpm db:reset
```

This removes every workspace database and its MySQL user, the platform database, the
files in local storage and the sign-in attempt counters, then recreates an empty platform.
The next account to sign up is the platform owner. Restart `pnpm dev` afterwards.

It refuses to run when `NODE_ENV` is `production`, when the database is not on this
machine, or when the storage folder is a drive root, the project folder or a home folder.
