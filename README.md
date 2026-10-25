# toadwright 🐸

> Playwright-style testing for AI agents. Assert on what your agent **did**, not just what it **said**.
> Run it N times, because one green run proves nothing.

**Status: pre-alpha.** Nothing is usable yet. Follow the [roadmap](ROADMAP.md) for progress.

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

First target: [Vercel AI SDK 7](https://ai-sdk.dev), which emits GenAI spans natively.

## Design

Decisions are recorded as [ADRs](docs/adr/README.md). Start with
[ADR-001](docs/adr/0001-span-collection-and-isolation.md): how spans are collected per test without touching
the app's telemetry.

## Development

```bash
pnpm install
pnpm check   # lint + typecheck + test + build
```

## License

[Apache-2.0](LICENSE)
