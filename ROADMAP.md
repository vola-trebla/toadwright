# toadwright — Roadmap

> Playwright-style testing for AI agents. Assert on what your agent *did*, not just what it *said*.
> Run it N times, because one green run proves nothing.

Status: **pre-v0.1 — M0 done on the code side, review fixes applied** · Last updated: 2026-10-25

Decisions live in [`docs/adr/`](docs/adr/README.md).

---

## 1. The problem

Product teams ship LLM agents with observability but without tests.

- Most teams already trace their agents, yet a large share run **no evaluations at all**, and output quality is the #1 blocker to production (LangChain State of Agent Engineering, 2026).
- Agents are **non-deterministic**. A test that passes once can fail 3 runs out of 10. Today that is invisible until production.
- Existing evals mostly grade **final text**. The bugs that hurt are in the **trajectory**: wrong tool, wrong order, wrong arguments, runaway loops, blown budgets.
- Tooling that does trace-based testing is either **platform-locked** (you need their SaaS to run your tests) or **closed source**.

## 2. The idea

A test library, not a platform. It lives inside the test runner teams already use.

1. **Collect** OpenTelemetry `gen_ai.*` spans in-process while the test runs (private recording tracer, no backend needed).
2. **Normalize** them into an `AgentTrace`: steps, model calls, tool calls with args/results, usage, cost, errors.
3. **Assert** on the trajectory with readable matchers.
4. **Repeat** the test N times and gate on pass rate, with a flakiness report.

Because the input is the **standard GenAI semantic conventions**, assertions work with any instrumentation that follows the spec. Vercel AI SDK v7 already emits `invoke_agent`, `chat` and `execute_tool` spans natively.

### Target developer experience

```ts
import { agentTest, expect, lessThan } from 'toadwright';

agentTest(
  'refund flow stays within policy',
  { runs: 10, minPassRate: 0.9, budget: { maxCostUsd: 0.5 } },
  async ({ trace, signal }) => {
    // Forward the signal: a budget stop aborts in-flight runs (ADR-003).
    await supportAgent.run('I want a refund for order 123', { abortSignal: signal });

    expect(trace).toHaveCalledTool('issue_refund', { args: { amount: lessThan(100) } });
    expect(trace).toCallToolsInOrder(['lookup_order', 'issue_refund']);
    expect(trace).not.toHaveCalledTool('delete_account');
    expect(trace).toStayWithin({ steps: 6, costUsd: 0.05 });
    expect(trace).not.toHaveErrors();
  },
);
```

```
✓ refund flow stays within policy   9/10 passed (90%, 95% CI 60–98%)
  🐸 croaked 1/10: toCallToolsInOrder — got [lookup_order, lookup_order, issue_refund]
```

## 3. Positioning

| | toadwright | Tracely | LangWatch Scenario | promptfoo | Cassette libs (tomiko, retake, agent-replay…) |
|---|---|---|---|---|---|
| Lives in your test runner | ✅ | ❌ (platform + CI gate) | ✅ (needs platform for judge) | partial | ✅ |
| Trajectory assertions on standard OTel spans | ✅ core | grading via LLM judge | judge reads traces | ❌ no span assertions found | tool-call matchers on HTTP cassettes |
| Flakiness / N-run gating as first-class | ✅ core | ❌ | ❌ | ❌ | ❌ |
| Prod trace → regression test | later (M5) | ✅ core | ❌ | ❌ | ❌ |
| Needs SaaS / account | ❌ | optional | yes | ❌ | ❌ |

**One-liner:** Tracely freezes production failures. toadwright catches them before merge, and tells you how flaky they are.

## 4. Principles

1. **Library first.** `npm i -D toadwright`, write a test, run `vitest`. No account, no backend, no Docker.
2. **Standard in, standard out.** Input is OTel `gen_ai.*`. Output is plain test results + JSON/JUnit. No proprietary trace format.
3. **Deterministic assertions first, LLM judge last.** A judge is itself flaky. It is an opt-in matcher, never the default.
4. **Explicit modes.** `replay` tests your code around the LLM (cheap, deterministic). `live` tests model behavior (costs money, statistical). Never mix them silently.
5. **Budget-safe by default.** Live runs have a hard per-suite cost cap. We wrote the article about the overnight bill; we will not ship that bug.
6. **Don't rebuild commodities.** Cassette record/replay already exists. Integrate, don't compete.

## 5. Key decisions

| ADR | Decision |
|---|---|
| [001](docs/adr/0001-span-collection-and-isolation.md) | API-only recording tracer + extra AI SDK integration; per-test root span; never touch app telemetry globals; `@opentelemetry/api` as peer only |
| [002](docs/adr/0002-pass-rate-gating-and-statistics.md) | Gate on observed pass rate, always print Wilson 95% CI, strict lower-bound mode opt-in; runs are not assumed independent |
| [003](docs/adr/0003-budgets-and-run-limits.md) | Live is opt-in and needs a budget; hard run caps; CI needs an explicit flag; unknown price is an error |
| [004](docs/adr/0004-runner-agnostic-core.md) | Runner-agnostic core, `toadwright/vitest` now, `toadwright/playwright` later; one package |
| [005](docs/adr/0005-repository-home.md) | Repo under `vola-trebla`, `toadwright` org reserved |

## 5a. Non-goals (for now)

- An observability platform, dashboard or trace viewer.
- A zoo of eval metrics (faithfulness, toxicity, …).
- Our own LLM proxy or cassette format.
- Python. TypeScript only until there is pull.
- A hosted service. Not before real users ask for it.

---

## 6. Milestones (M0–M5)

### M0 — Foundations (week 0)
- [x] Spike: span collection & isolation on AI SDK 7, both OTel lines → [ADR-001](docs/adr/0001-span-collection-and-isolation.md).
- [x] ADR-002…005: statistics, budgets, core layout, repo home.
- [x] ~~Claim `toadwright` on npm with a placeholder~~ — dropped: npm forbids publishing only to reserve a name. First publish moves to M1 (see below).
- [x] Create `vola-trebla/toadwright` repo.
- [x] ~~Reserve the `toadwright` GitHub org~~ — dropped: GitHub forbids holding account names for future use. Create it when the repo moves there ([ADR-005](docs/adr/0005-repository-home.md)).
- [x] Repo scaffold: TypeScript, ESM, vitest, plain `tsc` build, Biome, Apache-2.0, changesets.
- [x] CI matrix: legacy OTel line (API 1.9 / SDK 2.x) and modern line (API 1.10 / SDK 3.0).
- [x] Keep pnpm 12 supply-chain policy on (minimum release age); never bypass it to install a fresh version.
- [x] LinkedIn concept post (idea only, no deep tech) — maintainer.
- [x] dev.to article #1: OpenTelemetry JS 3.0 transition findings from the ADR-001 spike — maintainer.

### M1 — v0.1 "Assert" (weeks 1–2)
Goal: deterministic trajectory assertions on a single run.
- [ ] **First npm publish (`0.1.0-alpha`)** once `agentTest` and the first matchers work end to end — a package with genuine function, not a placeholder.
- [ ] Small reproducible example agent → reach out to design partners (see §7).
- [x] Span collector per ADR-001: API-only recording tracer, per-run context key, lazy context manager, `NoSpansCollectedError`.
- [x] In-house AsyncLocalStorage context manager (drop `@opentelemetry/context-async-hooks`).
- [ ] Port spike scenarios S1–S5 into the package test suite; run them on both OTel lines in CI.
- [x] Detect spans still open when the test body returns (unconsumed streams): `OpenSpansError`.
- [ ] `ContentNotRecordedError` when argument/result matchers meet `recordInputs/recordOutputs: false`.
- [ ] `AgentTrace` model: normalize `invoke_agent` / `chat` / `execute_tool` spans; tool args/results; usage; `error.type`.
- [ ] Pin a semconv version; isolate attribute names in one mapping module (the spec is still *Development*).
- [ ] Matchers: `toHaveCalledTool`, `toCallToolsInOrder`, `toHaveToolArgs`, `toStayWithin({ steps, tokens, costUsd })`, `toHaveErrors`, `toFinishWith(reason)`.
- [ ] Readable failure diffs: show actual trajectory as a compact timeline.
- [ ] First-class target: **Vercel AI SDK v7** native GenAI telemetry.
- [ ] Example: small support agent with 3–4 tools, tested end to end.
- [ ] Usage & cost per ADR-003: token budgets always; `costUsd` needs a user price map; unknown price is an error.

### M2 — v0.2 "Repeat" (weeks 3–4)
Goal: flakiness is measured, not guessed.
- [ ] `runs: N` with `minPassRate`; concurrency limit; fail-fast option.
- [ ] Gating per ADR-002: observed rate by default, Wilson 95% CI always printed, strict lower-bound mode; `errored` runs separate from failures.
- [ ] Independence warnings: cache-read dominance, run metadata (served model, sampling, mode) in every report.
- [ ] Flakiness report: per assertion, which run failed and why ("croaked 3/10").
- [ ] Budgets per ADR-003: `runs > 1` requires a budget; run ceiling 50; `maxTotalRuns`; pre-flight check; stop on cap; bounded overshoot; per-worker budget share; CI requires `TOADWRIGHT_ALLOW_LIVE=1`.
- [ ] Reporters: console, JSON, JUnit XML (so CI and Allure pick it up).
- [ ] Real-key experiments on Haiku-class model → numbers for article #2.

### M3 — v0.3 "Replay" (weeks 5–6)
Goal: cheap, deterministic CI runs.
- [ ] Integrate one existing cassette library (evaluate tomiko / retake / ai-sdk-record; pick one in an ADR).
- [ ] Explicit `mode: 'replay' | 'live' | 'record'` via config + env var.
- [ ] Tool fixtures API: mock side-effecting tools (`refund`, `send_email`) while keeping spans realistic.
- [ ] Detect stale cassettes when prompts or tool definitions change.

### M4 — v0.4 "Reach"
- [ ] Playwright Test fixture (`test.extend({ trace })`) — agent tests next to E2E tests.
- [ ] Anthropic SDK support via an OTel instrumentation (evaluate OpenLLMetry / OpenInference) or a thin wrapper.
- [ ] Legacy Vercel AI SDK `ai.*` spans → normalization adapter (v5/v6 users) — **only on real user demand**; v0.x officially supports AI SDK 7+.
- [ ] Opt-in LLM-judge matcher: `toSatisfy('politely declines refunds over $100')`, itself run N times.

### M5 — v1.0 "Promote"
- [ ] Import an OTLP trace (JSON export from Jaeger/Tempo/Langfuse) → generate a test skeleton.
- [ ] PII-safe capture for promoted traces (parse `gen_ai.input.messages`, redact per role/part).
- [ ] Stable public API, docs site, migration guide.

### Later / maybe (only with real users)
- Hosted flaky history across CI runs: which test degrades, after which commit or model change (paid layer, Cypress Cloud / Currents model).
- MCP-aware assertions (MCP semconv attributes on `execute_tool` spans).
- Python port.

---

## 7. Validation plan

**Success criterion:** on one real agent, show that a single green run guarantees nothing and that
repeated runs measure how reliably the agent behaves. Every milestone serves this demo.

| Step | Signal we want | Kill / pivot signal |
|---|---|---|
| dev.to article #1 (OTel findings) | ≥ the OTel article baseline (~29 reactions / ~27 comments), visits to the repo | Silence |
| Article #2 after M1/M2: "one green run proves nothing" | People asking how to run it on their agent | "Tracely/X already does this" with no pushback |
| Design partners | 3–5 people from commenters try it on a real agent | Nobody willing to try after 10 conversations |
| v0.2 release | Stars, issues from strangers, one external PR | No usage outside our own example after ~1 month |

Candidate design partners: commenters on the OTel article who raised real problems (token counting across providers, budget gating on mixed-model routes, PII in traces, streaming token counts).

**Outreach rules.** Start after the collector lands, with a small reproducible example — not after an npm release. The first message is not a pitch and not a request for free testing: describe the idea in two lines and ask how they solve it today. What we want to learn:

- which checks they actually need;
- what they consider a successful run;
- how much the statistical gate and the budget guard matter to them;
- whether they would plug it into a real project.

Do not build features for imagined needs ahead of these answers.

## 8. Risks

- **Spec churn.** GenAI semconv is still *Development* and moved to its own repo in 2026. Mitigation: one mapping module, pinned version, dual-read of old/new attribute names.
- **Content not recorded.** Tool args/results and messages are opt-in in most instrumentations. Mitigation: docs + a setup helper that enables recording in test env only.
- **Cost of N live runs.** Mitigation: budget cap, cheap model by default, replay mode for CI.
- **Competitors move into the same space** (Tracely, LangWatch, promptfoo). Mitigation: speed, test-runner-native DX, flakiness depth — the SDET angle.
- **OTel JS transition.** API 1.10 / SDK 3.0 shipped 2026-10-20 with breaking changes; users will be split across lines for months. Mitigation: no SDK dependency, API as peer, CI on both lines (ADR-001).
- **`@ai-sdk/otel` pins `@opentelemetry/api` 1.9.1.** Works today because older API copies can read newer globals. A future pin to a newer API in an app on the legacy line would silently no-op. Mitigation: the loud `NoSpansCollectedError`; watch upstream.
- **Name.** "Toad" is a Quest Software trademark (database tool). Low risk for a different name and niche; re-check if the project grows.

## 9. Resolved questions

| Question | Answer |
|---|---|
| Per-test span isolation | `toadwright.run` context key, no own spans; validated under concurrency on both OTel lines ([ADR-001](docs/adr/0001-span-collection-and-isolation.md)) |
| Default pass-rate gate | Observed rate; CI always shown; lower-bound strict mode opt-in ([ADR-002](docs/adr/0002-pass-rate-gating-and-statistics.md)) |
| Price table | None built in for v0.x; user price map; unknown price fails ([ADR-003](docs/adr/0003-budgets-and-run-limits.md)) |
| vitest-only vs runner-agnostic | Runner-agnostic core + thin adapters, one package ([ADR-004](docs/adr/0004-runner-agnostic-core.md)) |
| GitHub home | Personal account; org created only when the repo moves ([ADR-005](docs/adr/0005-repository-home.md)) |
| AI SDK 6 support | Not in v0.x: AI SDK 7+ officially; OTel spans stay the source, other SDKs via adapters on demand |
| Public API of v0.1 | `agentTest` + matchers only; the core stays internal until its interface stabilizes ([ADR-004](docs/adr/0004-runner-agnostic-core.md)) |
| When to publish to npm | First release with genuine function (M1), never a placeholder |

## 10. Open questions

- Shared cross-worker budget ledger: worth it after M2, or is the conservative split enough?
- Which cassette library for M3 (needs its own ADR)?
