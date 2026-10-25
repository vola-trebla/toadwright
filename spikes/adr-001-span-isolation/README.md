# Spike: ADR-001 span collection & isolation (AI SDK 7)

Throwaway code that validated [ADR-001](../../docs/adr/0001-span-collection-and-isolation.md).
Not part of the published package.

```bash
pnpm install
pnpm test        # current stack (ends on the modern OTel line)
./matrix.sh      # legacy line (api 1.9.1 / SDK 2.12) + modern line (api 1.10 / SDK 3.0)
```

| Scenario | What it proves |
|---|---|
| `s1-clean-env` | No app telemetry: full `gen_ai` tree is captured under the test root span; no global provider registered; context manager installed lazily |
| `s2-isolation` | 50 interleaved runs in one `Promise.all` + 10 `describe.concurrent` tests never leak spans |
| `s3-app-first` | App bootstraps `NodeSDK` first: app exports exactly the same spans as without toadwright; no diag warnings |
| `s4-failure-modes` | Disabled telemetry, per-call integration override and lost async context fail loudly; `recordInputs:false` hides tool args |
| `s5-toadwright-first` | Worst-case init order: app telemetry still works; one diag error is logged |

Mutation checks (run manually, all must turn tests red): remove the trace-id filter; never install
a context manager; make the recording tracer ignore the parent context.

Pinned versions are ≥ 1 day old because pnpm 12 enforces a minimum release age.
