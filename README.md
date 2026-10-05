<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-lockup-dark.svg" />
    <img src="docs/brand/logo-lockup.svg" alt="DBRB" width="300" />
  </picture>
</p>

<p align="center"><strong>Your database will be right back.</strong></p>

DBRB is a database backup and restore platform that several organisations can share safely.
Each organisation (a *workspace*) gets its own private database, chooses where its backups
are stored, and has a tamper-evident record of everything that happens in it.

> **Status: milestone 1 of 3 (foundation and storage).** Accounts, workspaces, storage and
> the activity record work today. Taking and restoring backups arrives in milestone 2.
> The original single-user tool still runs from [`legacy/`](legacy/) until then.
> The full plan is in [docs/PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md).

## What works today

- **A database of your own.** Signing up creates a workspace with its own MySQL database
  and its own MySQL user. One workspace's credentials cannot read another's data; MySQL
  itself refuses.
- **Storage you choose, from the admin panel.** Backups can go to the server's disk, to an
  S3 bucket run by the platform, or to an S3 bucket the workspace owns. The platform owner
  sets the rules; each workspace chooses within them. Bucket details are typed into the
  panel, tested, and stored encrypted. Nothing about storage lives in configuration files.
- **Built so that switching never strands a backup.** Every write returns its exact
  location, and reading goes by that location, so changing storage only affects new
  backups.
- **A record you can prove.** Every change is written to an append-only log in which each
  entry is chained to the one before it. Editing or deleting an entry is detectable.
- **Roles.** Owner, admin, operator, auditor and viewer, enforced on the server.
- **Two languages, every timezone.** English and Hindi. Times are stored in UTC and shown
  in each person's own timezone.
- **Dark and light themes**, usable on a phone.

## Run it on your machine

You need [Node.js 22 or newer](https://nodejs.org), [pnpm](https://pnpm.io/installation) and
[Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
pnpm install
```

```bash
cp .env.example .env
```

```bash
pnpm infra:up
```

```bash
pnpm dev
```

Then open <http://localhost:5173> and create an account. **The first account created is the
platform owner**, who also sees the *Platform* section of the menu.

`pnpm infra:up` starts four local services in Docker. They stand in for the cloud services
used later, so nothing needs an AWS account yet:

| Service | Address | Stands in for |
|---|---|---|
| MySQL 8.4 | `127.0.0.1:3310` | Amazon RDS |
| Valkey (Redis-compatible) | `127.0.0.1:6380` | Amazon ElastiCache |
| RustFS (S3-compatible) | `http://127.0.0.1:9000`, console on `:9001` | Amazon S3 |
| Mailpit (catches all email) | <http://localhost:8025> | Amazon SES |

To try the S3 options, connect a bucket in the app with the local details from
[docs/CONFIGURATION.md](docs/CONFIGURATION.md#trying-s3-locally).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the API (port 4000) and the web app (port 5173), restarting on changes |
| `pnpm infra:up` / `pnpm infra:down` | Starts / stops the local Docker services |
| `pnpm infra:reset` | Stops them and deletes their data |
| `pnpm db:reset` | Wipes local data and starts again from an empty platform. Refuses to run in production |
| `pnpm db:migrate` | Applies database changes to the platform database and every workspace database |
| `pnpm db:generate` | Creates migration files after a schema change |
| `pnpm test` | Unit tests. No services needed |
| `pnpm test:int` | Integration tests against the local Docker services |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` | Type checking, linting, formatting |
| `pnpm build` | Production build of the web app |

## How the code is organised

```
apps/
  api/         HTTP API (Express)
  web/         Web app (React)
packages/
  core/        Everything the server knows how to do: workspaces, encryption,
               settings, storage, the activity record, accounts
  shared/      Types, validation and the settings list, used by both api and web
infra/         Local Docker services
docs/          Plan, architecture, configuration, brand
ee/            Enterprise features (commercial licence). Empty for now
legacy/        The original single-user tool, kept running until milestone 2 replaces it
```

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the pieces fit together and why.
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md) lists every setting and where it lives.
- [docs/PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md) is the roadmap.
- [docs/BRAND.md](docs/BRAND.md) covers the name, logo and colours.

## Security

Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions need a signed
[contributor licence agreement](CLA.md), because DBRB is offered under two licences.

## Licence

DBRB is open-core.

- Everything outside `ee/` is licensed under the **GNU Affero General Public License v3.0
  only** (`AGPL-3.0-only`). You may use, self-host and modify it. If you run a modified
  version as a service for other people, you must publish your changes.
- The `ee/` directory is under a separate commercial licence. See [ee/LICENSE](ee/LICENSE).
- [`legacy/`](legacy/) keeps its original MIT licence.
