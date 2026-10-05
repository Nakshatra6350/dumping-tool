# DBRB Enterprise Edition

This directory is for features that are part of the paid plans: for example custom
roles, single sign-on, and dedicated database servers for one workspace.

**It is empty for now.** It exists so that the boundary is clear from the first day.

## Licence

Everything here is under the [DBRB Enterprise Edition Licence](LICENSE), not the AGPL
that covers the rest of the repository. In short: you may read it and run it for
development and testing; using it in production needs a subscription.

## Rules for code in this directory

- **The core must work without it.** Nothing outside `ee/` may import from `ee/`. Delete
  this directory and DBRB should still build, pass its tests and run.
- Enterprise features attach to the core through extension points the core provides,
  and are switched on by a licence key.
- The same standards apply as everywhere else: tests, the activity record, both
  languages, permissions enforced by the server.
