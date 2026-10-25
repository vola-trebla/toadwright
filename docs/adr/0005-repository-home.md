# ADR-005: Repository home

- **Status:** Accepted
- **Date:** 2026-10-24 · **Amended:** 2026-10-25 (no name reservation)

## Decision

- The repository lives under the maintainer's personal GitHub account (`vola-trebla/toadwright`).
  Stars and visibility accrue to the author whose articles drive the audience.
- ~~An empty `toadwright` GitHub organization is created only to reserve the name.~~ Dropped:
  GitHub's username policy says account names "may not be reserved or inactively held for future
  use", and npm's policy forbids publishing a package only to reserve its name. The organization is
  created when the repo moves there; the npm name is taken by the first real release (M1).
- If the project grows, the repo moves to the organization; GitHub redirects the old URL.

## Consequences

- ✅ Fastest start, audience continuity with the author's articles.
- ⚠️ A later transfer changes the canonical URL (redirects mitigate it).
