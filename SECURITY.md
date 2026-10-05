# Security

DBRB holds database credentials and backups, so security reports are taken seriously and
handled first.

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately through GitHub:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.

That creates a private conversation visible only to you and the maintainers.

Please include what you found, how to reproduce it, and what you think it allows. A
short proof of concept helps more than a long description.

## What to expect

| Step | When |
|---|---|
| We confirm we received your report | Within 7 days |
| We tell you whether we can reproduce it and how serious we judge it | Within 14 days |
| We keep you informed until it is fixed | At least every 30 days |
| We publish an advisory and credit you, if you wish | When a fix is released |

Please give us a reasonable time to fix a problem before making it public.

## Scope

In scope: everything in this repository except `legacy/`.

Particularly valuable:

- One workspace reading or changing another workspace's data.
- Reading a stored secret (S3 keys, database passwords) or getting one into a log, an
  error message or the activity record.
- Changing or removing an entry in the activity record without verification noticing.
- Acting without the required permission, or as the platform owner without being one.
- Making the server connect to an address inside its own network.
- Download links that work after they expire, or for a different file.

Out of scope: denial of service by volume, findings that need a compromised device or
browser, missing security headers with no demonstrated effect, and reports produced by a
scanner with no explanation of impact.

## Testing safely

- Test against your own installation. Please do not test against anyone else's.
- Do not access, change or delete data that is not yours.
- Stop and report as soon as you have shown the problem exists.

We will not take action against anyone who follows these rules in good faith.

## Supported versions

DBRB has not had a stable release yet. Fixes go to the main branch.

## How DBRB protects data

A short summary. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) has the detail and an
honest list of current limits.

- Each workspace has its own database, reached with its own database user that can see
  nothing else.
- Secrets are encrypted with a key that belongs to the workspace, which is itself
  protected by a master key held outside the database.
- Passwords are hashed with scrypt. Sessions are stored as hashes.
- Every change is written to an append-only record in which each entry is chained to the
  one before it.
- Permissions are checked by the server on every request.
- The browser is only allowed to load scripts, styles and fonts from DBRB itself.
