# ADR-003: Budgets, run limits and pricing

- **Status:** Accepted
- **Date:** 2026-10-24

## Context

N-run live tests multiply API calls. A misconfigured CI job (high `runs`, retries, a loop in the
agent, many workers) must not be able to burn a budget. toadwright's origin story is an overnight
API bill — this failure mode is unacceptable.

## Decision

### 1. Live mode is opt-in, and needs a budget

- Default mode is `replay`. Live calls happen only with `mode: 'live' | 'record'`.
- **Live mode refuses to start without `budget.maxCostUsd` or `budget.maxTokens`.** No implicit
  default budget.
- **In CI (`process.env.CI`)** live mode additionally requires `TOADWRIGHT_ALLOW_LIVE=1`. A missing
  cassette in CI fails the test; it never silently falls back to live.

### 2. Hard limits

| Limit | Scope | Default | Ceiling |
|---|---|---|---|
| `runs` | per test | 1 | 50 without `allowHighRunCount: true` |
| `maxTotalRuns` | per worker (share of suite) | 200 per suite, split as `200 / maxWorkers` | configurable |
| `maxConcurrency` | per worker | 4 | configurable |
| `maxCostUsd` / `maxTokens` | per suite | **required in live mode** | — |
| `perRun.maxTokens` | per run | none | optional |

### 3. Enforcement

- **Pre-flight (per worker):** before the first live call, compute `Σ runs` over the tests this
  worker will run; fail if it exceeds the worker's share of `maxTotalRuns`.
- **Spend accounting:** spend is updated from `gen_ai.usage.*` on **inference spans only**
  (`gen_ai.operation.name` ∈ `chat` / `text_completion` / `generate_content`). Agent and workflow
  spans (`invoke_agent`) carry totals and are never summed, otherwise spend is counted twice.
- **On cap:** no new run starts, and every in-flight run's `ctx.signal` is aborted. Aborted runs count
  as `errored: budget`; never-started runs as `skipped: budget`. Both go through the minimum-runs
  check of ADR-002, so a budget stop cannot produce a vacuous pass.
- **Overshoot bound:** at most `maxWorkers × maxConcurrency × (cost of one model call)`, because an
  aborted run can only finish the model call already in progress. This holds **only if the test
  passes `ctx.signal` to the agent call** (e.g. `abortSignal` in AI SDK). Docs and the README
  example must show it, and the report prints the actual overshoot.
- **Per-run guard:** when `perRun.maxTokens` is exceeded, the run's `AbortSignal` (exposed to the
  test as `ctx.signal`) is aborted and the run counts as `errored: budget`.

### 4. Multiple workers

Vitest runs files in parallel workers with separate memory. In v0.2 each worker gets a
**conservative share**: `cap / maxWorkers`. It can stop earlier than strictly needed but can never
exceed the total. A shared cross-worker ledger is a later optimization.

### 5. Pricing

- Token budgets work without any price data.
- `maxCostUsd` requires a price for every model used. **Unknown model price → configuration error**,
  never a silent zero.
- v0.x ships **no built-in price table**. Users pass a price map; a maintained snapshot may come later.
- Price key is the served model (`gen_ai.response.model`), falling back to the requested model, and
  the report shows both when they differ.

### 6. Phasing (before replay mode exists)

Modes arrive in M3. In M2 toadwright cannot tell live calls from mocked ones, so the guards key off
the multiplier instead: **any test with `runs > 1` requires a budget, and in CI requires
`TOADWRIGHT_ALLOW_LIVE=1`.** A single-run test without a budget is allowed. Spend tracking applies
whenever a budget is set. From M3 on, the rules in section 1 apply per mode.

### 7. Reporting

Every live summary prints: spend vs cap, runs executed / skipped by budget, overshoot, and price
source.

## Consequences

- ✅ CI cannot spend money by accident: three independent gates (opt-in mode, required budget,
  CI env flag).
- ✅ Spend is bounded even with high concurrency, with a documented worst case — provided tests
  forward `ctx.signal`. Without it, a looping in-flight run is bounded only by `perRun.maxTokens`.
- ⚠️ More configuration for live mode. Intentional friction.
- ⚠️ Conservative per-worker split may stop suites early on many workers.
