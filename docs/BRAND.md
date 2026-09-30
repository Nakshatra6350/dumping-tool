# DBRB brand guide

<p align="center"><img src="brand/logo-lockup.svg" alt="DBRB" width="360"></p>
<p align="center"><em>Your database will be right back.</em></p>

## The name

**DBRB**, in capitals in the wordmark and in running text. Lowercase **`dbrb`** is used only in code: the CLI, packages and domains. It's pronounced *"dee-bee-ar-bee"*.

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

## Logo: the "Return D"

<p align="center">
  <img src="brand/logo-mark.svg" alt="DBRB mark" width="96">&nbsp;&nbsp;&nbsp;
  <img src="brand/app-icon.svg" alt="DBRB app icon" width="96">
</p>

**Concept.** A bold, solid **D** whose inner space is cut as a left-pointing tip, so the empty space inside the letter **points back (←)**: *be right back*, restore.
- The solid weight signals stability and trust.
- The inner shape doubles as a **tag**, echoing snapshots and versions.
- There's no pictogram (no shield, lock or database cylinder), so it can't be mistaken for a stock icon.

**Where the idea came from:**
- **Airbnb's Bélo:** one shape carrying several meanings.
- **FedEx:** meaning hidden in negative space.
- **Dribbble's data-security category:** the strongest marks there are bold letterforms with a single meaningful cut.

**Construction** (128-unit grid; straight lines and circular arcs only, so it's reproducible and has no font dependency):
- **Outer D:** from x = 20 to x = 108 and y = 16 to y = 112. The bowl has a 48-unit radius; the left corners have an 8-unit radius.
- **Inner space:** the tip is at (42.5, 64); the inner bowl has a 22-unit radius. The wall is 22–26 units thick all round, so the weight looks even.

| Asset | File | Use |
|---|---|---|
| Mark (gradient) | [`brand/logo-mark.svg`](brand/logo-mark.svg) | Default mark on light or dark backgrounds |
| Mark (one colour) | [`brand/logo-mark-mono.svg`](brand/logo-mark-mono.svg) | Single-colour contexts: print, embossing, monochrome UI (`currentColor`) |
| App icon / favicon | [`brand/app-icon.svg`](brand/app-icon.svg) | App icon, favicon, social avatars. Also used by the app as `public/favicon.svg` |
| Wordmark | [`brand/wordmark.svg`](brand/wordmark.svg) | "DBRB" on its own (`currentColor`) |
| Lockup, light backgrounds | [`brand/logo-lockup.svg`](brand/logo-lockup.svg) | Mark + wordmark, dark ink |
| Lockup, dark backgrounds | [`brand/logo-lockup-dark.svg`](brand/logo-lockup-dark.svg) | Mark + wordmark, light ink |

### Usage rules
- **Clear space:** keep at least the width of the D's stem (about ¼ of the mark's width) empty on every side.
- **Minimum size:** mark 16 px (at 24 px and below, prefer the app icon); lockup 96 px wide.
- **Colour:** the brand gradient `#6366f1 → #a855f7` runs top-left to bottom-right. On the gradient itself, use the white mark (as in the app icon).
- **Don't:**
  - Flip or rotate the mark. The tip must always point left.
  - Stretch it, outline it, add shadows or effects, or recolour it outside the brand palette.
  - Place it on busy photos.
  - Retype the wordmark in a font.

## Color and type

| Token | Value | Use |
|---|---|---|
| Brand gradient | `#6366f1 → #a855f7` | Logo, primary buttons, highlights |
| Ink (dark UI) | `#eef0f6` on `#0b0d12` | Text on the dark-first UI |
| Ink (light UI) | `#0f172a` on `#f5f6fa` | Text on the light UI |
| Success | `#0ca30c` | "Back" / success states (always with icon + label) |
| Critical | `#d03b3b` | Failures (always with icon + label) |
| Wordmark | Custom geometric logotype (drawn, not a font) | "DBRB" in the logo |
| UI font | Inter | Everything else |
| Code font | JetBrains Mono | Code, CLI examples, technical values |

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
