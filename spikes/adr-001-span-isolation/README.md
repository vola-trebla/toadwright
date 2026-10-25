# Spike: ADR-001 span collection & isolation (AI SDK 7)

Throwaway code that validated [ADR-001](../../docs/adr/0001-span-collection-and-isolation.md).
Not part of the published package.

```bash
pnpm install
pnpm test        # current stack (ends on the modern OTel line)
./matrix.sh      # both OTel lines × both designs (TOADWRIGHT_DESIGN=ctxkey | rootspan)
```

| Scenario | What it proves |
|---|---|
| `s1-clean-env` | No app telemetry: full `gen_ai` tree is captured and tagged with the run id; no global provider registered; context manager installed lazily |
| `s2-isolation` | 50 interleaved runs in one `Promise.all` + 10 `describe.concurrent` tests never leak spans |
| `s3-app-first` | App bootstraps `NodeSDK` first: app's exported span shape (names, parents, attributes) is identical to a run without toadwright; no diag warnings. `rootspan` fails here by design |
| `s4-failure-modes` | Disabled telemetry, per-call integration override and lost async context fail loudly; `recordInputs:false` hides tool args |
| `s5-toadwright-first` | Worst-case init order: app telemetry still works; exactly one diag error (duplicate context registration) |

Mutation checks (run manually, all must turn tests red): remove the run-id filter; never install
a context manager; make the recording tracer drop the run id.

Pinned versions are ≥ 1 day old because pnpm 12 enforces a minimum release age.
