# ADR-001: Span collection and per-test isolation

- **Status:** Accepted — validated by spike [`spikes/adr-001-span-isolation`](../../spikes/adr-001-span-isolation/)
- **Date:** 2026-10-24 · **Amended:** 2026-10-25 (decision 3: context key instead of a root span)
- **Deciders:** maintainer

## Context

toadwright asserts on an agent's trajectory using OpenTelemetry `gen_ai.*` spans. It must:

1. Capture every `gen_ai` span an agent produces during one test.
2. Keep spans of concurrently running tests apart (`Promise.all`, `describe.concurrent`).
3. **Never break the application's own telemetry** — no replaced providers, context managers,
   exporters, or changed span output.
4. Fail loudly when nothing was captured, instead of passing vacuously.

The OTel JS ecosystem is mid-transition: `@opentelemetry/api` 1.10 and SDK 3.0 shipped on
2026-10-20. Apps will run either the **legacy line** (API ≤ 1.9, SDK 2.x) or the **modern line**
(API 1.10, SDK 3.0) for months.

## Decision

1. **Private, API-only recording tracer.** toadwright implements a minimal `Tracer`/`Span` on top of
   `@opentelemetry/api` that records spans in memory. It does **not** depend on any OTel SDK package
   and never registers a global tracer provider.
2. **Additional AI SDK integration.** toadwright calls
   `registerTelemetry(new OpenTelemetry({ tracer: recordingTracer }))`. `registerTelemetry` appends
   to a global list, so it runs next to the app's integration, which keeps exporting unchanged.
3. **Per-run context key** (amended 2026-10-25). Each test run executes inside
   `context.with(ctx.setValue(RUN_KEY, runId), fn)`. The recording tracer reads `RUN_KEY` from the
   context every span starts in and tags the span with it; a run owns exactly the spans tagged with
   its id. toadwright creates **no span of its own**, so the app's span tree is unchanged. (The
   original design — a per-test root span plus a trace-id filter — gave the app's root span an
   unexported parent; see finding 5 and "Context-key re-run" below.)
4. **Context manager only if missing, installed lazily.** On the first test run, a probe checks
   whether `context.with()` propagates values. If not, toadwright installs an AsyncLocalStorage
   context manager. If the app already has one, toadwright reuses it.
5. **Hands off globals.** toadwright never calls `trace.setGlobalTracerProvider`,
   `propagation.setGlobalPropagator`, or `diag.setLogger`.
6. **Dependency policy.**
   - `@opentelemetry/api`: **peer** dependency, `>=1.9.1 <2.0.0` (1.9.1 is the lowest version CI tests).
     Never a direct dependency.
   - `ai` (`^7.0.0`), `@ai-sdk/otel` (`^1.0.0`) and, optionally, `vitest` (`^5.0.0`): peer dependencies.
     Ranges never promise more than CI tests.
   - No `@opentelemetry/sdk-*` packages.
   - The context manager becomes an in-house ~50-line AsyncLocalStorage implementation in M1,
     replacing `@opentelemetry/context-async-hooks`, whose peer range caps the API at `<1.11`.
7. **Loud failure.** If a test captured zero `gen_ai` spans, it fails with `NoSpansCollectedError`
   and a diagnosis: spans found in another trace → "async context was lost"; none at all →
   "telemetry disabled or overridden per call".

## Spike results

AI SDK `ai@7.0.150`, `@ai-sdk/otel@1.0.150`, vitest 5.0.5, Node 22.

| Scenario | Legacy line, recording tracer | Legacy line, SDK 2.x provider | Modern line, recording tracer |
|---|---|---|---|
| S1 clean env: full tree captured, no global provider | ✅ | ✅ | ✅ |
| S2 50× `Promise.all` + 10× `describe.concurrent`, no leaks | ✅ | ✅ | ✅ |
| S3 app `NodeSDK` first: app output identical, no diag noise | ✅ | ✅ | ✅ |
| S4 failure modes are loud | ✅ | ✅ | ✅ |
| S5 toadwright first: app telemetry still works | ✅ (1 diag error) | ✅ (1 diag error) | ✅ (1 diag error) |
| Peer ranges satisfiable | ✅ | ✅ | ✅ recording only — SDK 2.x requires API `<1.10` |

27 tests per configuration; 3 of them only log (parentage, diag noise, a filler assertion) and
cannot fail — the "(1 diag error)" cells are read from console output, not asserted. Mutation checks
confirmed the remaining suite has teeth: removing the trace-id filter, skipping the context manager,
or ignoring the parent context each turns 11–18 tests red (an independent review re-run got 15–18).

Captured tree for a 2-tool agent:

```
invoke_agent mock-support-1        ← gen_ai.agent.name, usage totals, input/output messages
  step 1
    chat mock-support-1
    execute_tool lookup_order      ← gen_ai.tool.name, gen_ai.tool.call.arguments / .result
  step 2
    chat mock-support-1
    execute_tool issue_refund
  step 3
    chat mock-support-1
```

## Findings

1. **SDK 3.0 has three breaking changes for our use** — `SimpleSpanProcessor(exporter)` became
   `SimpleSpanProcessor({ exporter })`, `BasicTracerProvider` became `TracerProvider`, and
   `sdk-node` dropped its `tracing` re-export. Depending on any SDK line would break half of our users.
2. **`@ai-sdk/otel` pins `@opentelemetry/api` 1.9.1 as a direct dependency.** On the modern line two
   API copies coexist. It works only because the API's compatibility rule lets an older copy read
   globals registered by a newer one (`own.minor <= global.minor`). The reverse fails silently
   (no-op). Hence toadwright must share the app's API copy via a peer dependency.
3. **Per-call `telemetry.integrations` overrides global integrations.** Our integration then never
   runs. Covered by the loud error; must be documented.
4. **`recordInputs: false` / `recordOutputs: false` strip tool arguments and results.** Spans still
   exist, so argument matchers must fail with "content not recorded", not "arguments mismatch".
5. **Cross-provider parentage.** The app's `invoke_agent` span is parented on the toadwright test
   span, whose id the app never exports. With toadwright active, the app's exported trace therefore
   had a missing root. The first spike only compared span **names**, so no assertion caught it.
   **Resolved** by decision 3 as amended.
6. **Init order matters only for the context manager.** If toadwright installs it before the app's
   `NodeSDK.start()`, the API logs one "duplicate registration of API: context" error. App telemetry
   keeps working because both managers are AsyncLocalStorage-based. Mitigation: lazy install plus docs
   ("bootstrap app telemetry in `setupFiles` before toadwright").
7. **Streaming.** `streamText` spans end only after the stream is consumed. A test that returns
   before consuming the stream would capture a partial tree.
8. **`SimpleSpanProcessor` in `NodeSDK` exports asynchronously** (it waits for async resource
   detection). Irrelevant to the recording tracer, which records synchronously on `span.end()`.
9. **pnpm 12 enforces a minimum release age** for dependencies. Brand-new versions (published the
   same day) are rejected; the spike pins versions ≥ 1 day old.

## Consequences

- ✅ Works on both OTel lines with one code path and zero SDK dependencies.
- ✅ The app exports identical spans with and without toadwright: names, parents and attributes
  (span ids, timestamps, `gen_ai.response.id` and timing attributes excluded).
- ⚠️ We own a small `Tracer`/`Span` implementation. The API surface is stable 1.x, but new optional
  methods must be tracked.
- ⚠️ v0.x supports AI SDK 7 natively. Other instrumentations need their own adapter (M4).

### Follow-ups for M1

- [x] **Spike first:** replace the per-test root span with a context key (`toadwright.run`) and
  bucket spans by it in the recording tracer. Done — see "Context-key re-run".- [ ] In-house AsyncLocalStorage context manager; re-run the spike suite against it.
- [ ] Detect spans still open when the test body returns ("2 spans still open — did you consume the stream?").
- [ ] `ContentNotRecordedError` for argument/result matchers.
- [ ] Port S1–S5 into the package's own test suite and the legacy/modern CI matrix (the log-only
  tests are already assertions in the spike since the re-run).

## Context-key re-run (2026-10-25)

Same spike, `TOADWRIGHT_DESIGN=ctxkey` vs `rootspan`, recording tracer only (the SDK-provider
variant was dropped: ADR-001 already rejected it). The three log-only tests became assertions,
and S3 now compares the app's exported span **shape** (name, parent, attributes) against a baseline
run without toadwright.

| Design | Legacy line | Modern line |
|---|---|---|
| `ctxkey` | 27/27 ✅ | 27/27 ✅ |
| `rootspan` | 25/27 — fails "identical spans" and "app root stays a true root" | same |

The `rootspan` failures are exactly finding 5, so the new S3 assertions have teeth. Mutation checks
on `ctxkey` (no run-id filter, no context manager, tracer drops the run id) turn 16–18 tests red.

## Alternatives considered

| Option | Why not |
|---|---|
| OTel SDK provider + `InMemorySpanExporter` | Works on the legacy line only; SDK 2.x peer range excludes API 1.10; three breaking changes in 3.0 |
| Register a global tracer provider | Replaces or fights the app's provider — violates requirement 3 |
| Add a processor to the app's provider | SDK 2.x/3.0 removed `addSpanProcessor`; processors are constructor-only |
| AI SDK `Telemetry` callbacks or the `ai:telemetry` diagnostics channel directly | No OTel needed, but couples us to AI SDK internals and loses "any `gen_ai` instrumentation". Kept as a fallback |
| Filter spans by time window | Unsafe under concurrency |
