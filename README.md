# toadwright 🐸

[![CI](https://github.com/vola-trebla/toadwright/actions/workflows/ci.yml/badge.svg)](https://github.com/vola-trebla/toadwright/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

> Playwright-style testing for AI agents. Assert on what your agent **did**, not just what it **said**.
> Run it N times, because one green run proves nothing.

**Status: pre-alpha, building in public.** Not on npm yet — the first release ships when `agentTest` and
the first matchers work end to end. The example below is the target API.

## Progress

- ✅ **M0 — foundations:** package scaffold, CI on Node 22/24 × both OpenTelemetry JS lines, ADRs, milestone review.
- 🚧 **M1 — "Assert":** span collection and trajectory assertions on a single run.
  - ✅ API-only recording tracer that tags spans per test run
  - ✅ In-house AsyncLocalStorage context manager
  - ✅ Span collector that fails loudly on empty runs and unconsumed streams
  - ⏳ `agentTest`, first matchers
- ⏳ **M2 — "Repeat":** N runs, pass-rate gate with confidence interval, budgets.
- ⏳ **M3 — "Replay":** deterministic CI runs from recorded fixtures.

Full plan: [ROADMAP.md](ROADMAP.md).

## The idea

```ts
agentTest(
  'refund flow stays within policy',
  { runs: 10, minPassRate: 0.9, budget: { maxCostUsd: 0.5 } },
  async ({ trace, signal }) => {
    // Forward the signal: a budget stop aborts in-flight runs (ADR-003).
    await supportAgent.run('I want a refund for order 123', { abortSignal: signal });

    expect(trace).toHaveCalledTool('issue_refund', { args: { amount: lessThan(100) } });
    expect(trace).toCallToolsInOrder(['lookup_order', 'issue_refund']);
    expect(trace).toStayWithin({ steps: 6, costUsd: 0.05 });
  },
);
```

```
✓ refund flow stays within policy   9/10 passed (90%, 95% CI 60–98%)
  🐸 croaked 1/10: toCallToolsInOrder — got [lookup_order, lookup_order, issue_refund]
```

- **Trajectory assertions** on standard OpenTelemetry `gen_ai.*` spans: tools, order, arguments, steps, tokens, cost.
- **Flakiness is measured.** Each test runs N times and gates on the pass rate, with the uncertainty printed.
- **A library, not a platform.** Runs inside vitest. No account, no backend.
- **Budget-safe.** Live runs need an explicit budget and hard caps, so CI cannot burn money by accident.
- **Leaves your telemetry alone.** No global providers, no SDK dependency.

## Compatibility (planned for the first release)

| | Supported |
|---|---|
| Instrumentation | [Vercel AI SDK 7+](https://ai-sdk.dev) (emits GenAI spans natively); other SDKs via adapters later |
| OpenTelemetry JS | API 1.9.1 – 1.x, both the SDK 2.x and the SDK 3.0 line — toadwright depends on the API only, as a peer |
| Test runner | vitest 5 (Playwright Test later) |
| Node.js | 22.12+ |

## Design

Decisions are recorded as [ADRs](docs/adr/README.md). Start with
[ADR-001](docs/adr/0001-span-collection-and-isolation.md): how spans are collected per test without touching
the app's telemetry. Along the way it documents a few things worth knowing even if you never use toadwright:

- OpenTelemetry JS SDK 3.0 (October 2026) breaks `SimpleSpanProcessor`, renames the tracer provider and splits
  peer ranges so that no single SDK dependency covers both lines.
- `@ai-sdk/otel` pins `@opentelemetry/api` 1.9.1, so apps on API 1.10 run two copies of the API.
- On Node 24, `AsyncLocalStorage.disable()` leaves in-flight async work with its context, contrary to the docs.

## Development

```bash
pnpm install
pnpm check   # lint + typecheck + test + build
```

## License

[Apache-2.0](LICENSE)
