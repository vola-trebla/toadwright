# ADR-004: Runner-agnostic core with thin adapters

- **Status:** Accepted
- **Date:** 2026-10-24 · **Amended:** 2026-10-25 (public API scope of v0.1)

## Decision

- The core is plain TypeScript with no test-runner imports: span collection (ADR-001), the
  `AgentTrace` model, assertion functions returning structured results, run orchestration
  (N runs, budgets, statistics).
- Runner adapters are thin: `toadwright/vitest` in M1 (`agentTest`, `expect.extend` matchers,
  reporter); `toadwright/playwright` in M4 (`test.extend({ trace })`).
- **One package with subpath exports**, not a monorepo. Runner packages are optional peer
  dependencies.
- **Public API of v0.1 (amended 2026-10-25):** only `agentTest` and the matchers, from
  `toadwright/vitest`. The core (collector, `AgentTrace`, orchestration) stays **internal**: built
  runner-independent and tested on its own, but not exported. A public API is a compatibility
  contract, and an early low-level API is the hardest part to change. Exporting the core is
  reconsidered once its interface has been stable across a few releases. Runner independence is an
  architecture property, not a promise to support every usage of the core.

## Consequences

- ✅ Playwright support does not require rewriting the core.
- ✅ Core logic is unit-testable without a runner.
- ⚠️ Slightly more structure in v0.1 than a vitest-only library.
- ⚠️ Optional peers must be guarded with clear import errors.
