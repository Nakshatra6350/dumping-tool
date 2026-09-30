# DBRB brand guide

<p align="center"><img src="brand/logo-lockup.svg" alt="dbrb, your database will be right back" width="420"></p>

## The name

**DBRB**, written **`dbrb`** in the logo and wordmark and **DBRB** in running text. It's pronounced *"dee-bee-ar-bee"*.

It works on two levels, and both are true:
1. **"DB, be right back."** From *brb*, the chat shorthand everyone knows. Your database went away for a moment, and it's coming right back.
2. **"DataBase Restore & Backup"** (DB R&B). The plain-English meaning, for procurement forms and enterprise buyers who want to know what it does.

## Taglines

| Use | Line |
|---|---|
| **Primary** | **Your database will be right back.** |
| Short / social | *Crashed? brb.* |
| Product promise | *Backup. Restore. Be right back.* |
| Proof-of-recovery angle | *Backups that say brb, not bye.* |
| Enterprise / compliance | *Every backup verified. Every restore proven.* |
| Hindi (launch language) | *डेटाबेस गया? बस अभी वापस आया।* ("Database gone? Back in a moment.") |

## Product and feature names

The product family:

| Name | What it is |
|---|---|
| **DBRB Cloud** | The hosted, multi-tenant platform (Free / Pro / Max / Enterprise) |
| **DBRB Self-Hosted** | Community edition (AGPL, free) and Enterprise edition (license key) |
| **DBRB Console** | The platform admin console (internal) |
| **dbrb agent** | The outbound-only agent that runs in customer networks (Phase 8+) |
| **dbrb CLI** | `dbrb backup`, `dbrb restore`, `dbrb status` |

Feature names that carry the "right back" theme:

| Name | Feature |
|---|---|
| **Comeback Check** | Automated restore verification |
| **Comeback Drills** | Scheduled recovery drills that measure RTO/RPO |
| **Proof Pack** | The compliance evidence pack (PDF + JSON) |
| **Right-Back Score** | The backup health score per database |
| **Away Mode** | A tenant paused after plan expiry (read-only window) |

Plan names stay plain (Free, Pro, Max, Enterprise) so pricing is instantly clear worldwide.

## Voice and tone

- **Calm, friendly, precise.** We are the friend who says "brb" and actually comes back.
- **Light humour in empty states and success messages, never in errors.** An error message is serious and tells the user exactly what to do next.
  - Success: *"Backed up. See you on the other side of the next deploy."*
  - Error: *"Backup failed: the MySQL user lacks the LOCK TABLES permission. Grant it or turn off table locking in job settings."*
- **Enterprise, compliance, legal and billing pages are strictly professional.** No puns there.
- **Status words are clear first, and on-brand second.** For example, "Running" (not only "brb…"), so screen readers and non-native speakers always understand.

## Logo

| Asset | File |
|---|---|
| Mark (app icon, avatar) | [`brand/logo-mark.svg`](brand/logo-mark.svg) |
| Lockup (mark + wordmark + tagline) | [`brand/logo-lockup.svg`](brand/logo-lockup.svg) |

- **Concept:** a chat bubble (the "brb" moment) containing a database cylinder with a **typing indicator** ("be right back…").
- **Clear space:** keep at least ¼ of the mark's width empty around it.
- **Small sizes:** a simplified 16px favicon (bubble + dots only) comes in Phase 0.
- **Don't:** recolor the mark outside the brand gradient, stretch it, or put it on busy photos.

## Color and type

| Token | Value | Use |
|---|---|---|
| Brand gradient | `#6366f1 → #a855f7` | Logo, primary buttons, highlights |
| Ink (dark UI) | `#eef0f6` on `#0b0d12` | Text on the dark-first UI |
| Ink (light UI) | `#0f172a` on `#f5f6fa` | Text on the light UI |
| Success | `#0ca30c` | "Back" / success states (always with icon + label) |
| Critical | `#d03b3b` | Failures (always with icon + label) |
| Wordmark font | JetBrains Mono, 700 | `dbrb` wordmark (the developer feel) |
| UI font | Inter | Everything else |

## Names and handles (checked 30 Sep 2026)

| Asset | Status | Recommendation |
|---|---|---|
| `dbrb.com` | Registered by someone else | Not needed; may try to buy later if affordable |
| **`dbrb.dev`** | Looked available | **Primary domain**: app, docs, email (`app.dbrb.dev`, `docs.dbrb.dev`) |
| `dbrb.in` | Looked available | Cheap defensive buy for India; redirect to `.dev` |
| `getdbrb.com` | Looked available | Optional; redirect for people who type `.com` |
| `dbrb.io` / `.app` / `.cloud` / `.co` | Looked available | Not needed now |
| GitHub `dbrb` | Taken | Use **`dbrbhq`** (available) |
| npm `dbrb`, `@dbrb/*` | Available | Reserve for the CLI and SDK |
| Docker Hub `dbrb` | Taken | Publish images on **GHCR**: `ghcr.io/dbrbhq/dbrb` |

"Available" is based on public registry lookups (RDAP / registry APIs) and must be confirmed at checkout. Some registrars charge premium prices for short names.

## Trademark

A quick web search found no company or software product named DBRB. **Before public launch**, run formal searches and consider filing in the software classes:
- **Class 9:** downloadable software.
- **Class 42:** SaaS.

Search in India ([IP India](https://ipindia.gov.in/)), then the US ([USPTO](https://www.uspto.gov/trademarks/search)) and EU ([EUIPO](https://euipo.europa.eu/eSearch/)). A four-letter initialism is registrable when it isn't descriptive, and "DBRB" isn't a standard term, which works in our favour. It's still worth a short consultation with a trademark agent before filing.
