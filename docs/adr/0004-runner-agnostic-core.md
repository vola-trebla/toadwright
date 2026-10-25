# ADR-004: Runner-agnostic core with thin adapters

- **Status:** Accepted
- **Date:** 2026-10-24

## Decision

- The core is plain TypeScript with no test-runner imports: span collection (ADR-001), the
  `AgentTrace` model, assertion functions returning structured results, run orchestration
  (N runs, budgets, statistics).
- Runner adapters are thin: `toadwright/vitest` in M1 (`agentTest`, `expect.extend` matchers,
  reporter); `toadwright/playwright` in M4 (`test.extend({ trace })`).
- **One package with subpath exports**, not a monorepo. Runner packages are optional peer
  dependencies.

## Consequences

- ✅ Playwright support does not require rewriting the core.
- ✅ Core logic is unit-testable without a runner.
- ⚠️ Slightly more structure in v0.1 than a vitest-only library.
- ⚠️ Optional peers must be guarded with clear import errors.
