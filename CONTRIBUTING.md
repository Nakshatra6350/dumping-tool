# Contributing to DBRB

Thank you for considering it. This page covers how to get set up, what a change needs
before it can be merged, and the one piece of paperwork.

## Before you start

- **Found a security problem?** Do not open a public issue. See [SECURITY.md](SECURITY.md).
- **Planning something large?** Open an issue first and describe it. It is disappointing
  to build something that turns out not to fit.
- **The licence agreement.** DBRB is offered under two licences (see the
  [README](README.md#licence)), so every contributor is asked to agree to the
  [contributor licence agreement](CLA.md) once. You keep ownership of your work.

## Set up

You need Node.js 22 or newer, pnpm and Docker.

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

The app is at <http://localhost:5173>. The first account you create is the platform
owner. `pnpm db:reset` starts again from nothing.

## Where things go

| If you are changing | It belongs in |
|---|---|
| What the product does: workspaces, storage, settings, the activity record | `packages/core` |
| A type, validation rule or setting used by both server and browser | `packages/shared` |
| An HTTP route | `apps/api`, kept thin: check the permission, validate, call core |
| A screen | `apps/web/src/features/<feature>` |
| An enterprise-only feature | `ee/`, under its own licence. The core must work without it |

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the parts fit together.

## What a change needs

Run these before opening a pull request. The same checks run automatically on every pull
request.

```bash
pnpm format
```

```bash
pnpm lint
```

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm test:int
```

Beyond passing checks:

- **Tests for behaviour, not for lines.** A change to what the product does comes with a
  test that would have failed before it. Integration tests use the real local services
  and their own throwaway database, so they never touch your development data.
- **Anything that crosses workspaces needs an isolation test.** If a route takes an ID,
  there should be a test that calls it as another workspace and is refused.
- **Every change a person makes is recorded.** If you add an action that changes
  something, write it to the activity record. Never put a secret in it.
- **No text in code.** Everything a person reads goes in `apps/web/src/locales`, in
  English and Hindi. The compiler rejects a language file with a missing key.
- **Times are stored in UTC** and shown in the reader's timezone.
- **Colours come from the existing tokens.** See [docs/BRAND.md](docs/BRAND.md). Please do
  not introduce new colours.
- **Check it on a phone-width screen**, in both themes and both languages.
- **Permissions are enforced by the API.** Hiding a button is a courtesy to the person
  using the app, not the protection.

## Commits and pull requests

- Keep a pull request to one subject. Smaller is easier to review and safer to merge.
- Write the commit message as what the change does and why, in plain words.
- Say how you tested it, and include a screenshot for anything visible.

## Database changes

Edit the schema in `packages/core/src/db`, then:

```bash
pnpm db:generate
```

This writes a migration file under `packages/core/drizzle`. Commit it with your change.
There are two sets: one for the platform database and one applied to every workspace
database. Never edit a migration that has already been merged; add a new one.
