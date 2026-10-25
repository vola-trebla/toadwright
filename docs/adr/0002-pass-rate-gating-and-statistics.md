# ADR-002: Pass-rate gating and statistical interpretation

- **Status:** Accepted
- **Date:** 2026-10-24

## Context

An agent test runs N times (`runs: N`) and passes if enough runs pass. We need a gating rule and an
honest description of what the numbers mean.

## Decision

1. **Default gate: observed pass rate.** A test passes when `passed / completed >= minPassRate`.
2. **Always report a 95% Wilson score interval** next to the rate, so uncertainty is visible:
   `9/10 passed (90%, 95% CI 60–98%)`.
3. **Strict mode (opt-in):** gate on the interval's lower bound. Intended for release gates, not
   every PR.
4. **Infrastructure errors are not behavioral failures.** Rate limits, 5xx responses, timeouts and
   budget aborts are counted separately as `errored`, excluded from the pass rate, and fail the test
   when they exceed a threshold (default: any errored run fails the test with a clear message).
5. **Minimum runs, checked twice.** `minPassRate < 1` requires `runs >= 5` at config time **and**
   `completed >= 5` at gate time. Fewer completed runs (budget stop, errors, skips) fail the test
   with an explicit message, e.g. `insufficient runs: 1/10 completed (9 skipped: budget)`. A gate
   over zero completed runs is always a failure, never `0/0`.

### Why not gate on the lower bound by default

| Runs, all green | Lower bound of the 95% interval |
|---|---|
| 10/10 | 72% |
| 20/20 | 84% |
| 35/35 | 90% |

Passing a 0.9 gate on the lower bound needs ≥ 35 green runs. Too slow and expensive for every PR.

## Limits of interpretation (must be stated in docs and reports)

The Wilson interval assumes **independent, identically distributed** runs. Repeated agent runs
often are not:

- **Provider-side caching.** Prompt caching or response caching can make runs near-identical, so
  10 runs carry the information of fewer.
- **Correlated infrastructure.** Rate limiting, backoff and regional load hit consecutive runs
  together.
- **Model drift.** The served model (`gen_ai.response.model`) or provider behavior can change
  mid-suite or between days.
- **Shared state.** Tools, mocks, fixtures or databases that keep state between runs couple outcomes.
- **Sampling settings.** `temperature: 0` or a fixed `seed` reduce variance artificially; the result
  says little about production settings.
- **Fixed prompt.** N runs of one prompt measure variance *for that input*, not the agent's quality
  across inputs.

Therefore:

- A pass rate is an **observed rate under the run's conditions**, never "the probability the agent
  works". Reports must not use that wording.
- The interval is **nominal**. With correlated runs, the real uncertainty is wider than printed.
- Results are comparable across commits only when model id, sampling settings and mode
  (`live`/`replay`) match. Reports always print them.
- Replay mode is deterministic by construction. Pass rates over replayed runs are meaningless and
  N>1 in replay mode is rejected.

## Mitigations built into the tool

- Reports include run metadata: requested and served model, sampling settings, mode, cache-hit
  tokens (`gen_ai.usage.cache_read.input_tokens`).
- Warn when cache-read tokens dominate input tokens ("runs may not be independent").
- Fresh fixtures per run by default; shared state is opt-in.
- Option to spread runs (`concurrency: 1`, jitter between runs) to reduce correlated infra effects.

## Consequences

- ✅ Usable defaults for PR gating; uncertainty is always visible.
- ⚠️ A lucky streak can pass the default gate. The printed interval and strict mode address that.
- ⚠️ Documentation burden: the "limits" section ships in README and in the report footer.
