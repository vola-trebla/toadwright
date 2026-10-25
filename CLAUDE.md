# toadwright — guide for AI agents

`toadwright` is Playwright-style testing for AI agents. It collects OpenTelemetry `gen_ai.*` spans
while a test runs, asserts on the agent's trajectory (tools, order, arguments, steps, cost), and runs
each test N times to gate on the pass rate.

- Plan and milestones: [ROADMAP.md](ROADMAP.md)
- Why things are the way they are: [docs/adr/](docs/adr/README.md)

## Commands

```bash
pnpm install
pnpm check         # lint + typecheck + test + build — run before every commit
pnpm format        # Biome autofix (markdown is excluded on purpose)
pnpm test          # vitest
pnpm build         # tsc -> dist/
```

Notes: pnpm 12 does not accept `-s`. pnpm 12 enforces a minimum release age for dependencies —
never bypass it; pin a version that is at least a day old instead.

## Invariants (never break these)

1. **Never break the app's telemetry** (ADR-001). No `trace.setGlobalTracerProvider`,
   `propagation.setGlobalPropagator` or `diag.setLogger`. Install a context manager only when none
   works. The app must export the same spans with the same attributes with and without toadwright.
   Known exception until the M1 spike: the app's root `gen_ai` span gets an unexported toadwright
   parent (ADR-001, finding 5).
2. **No OpenTelemetry SDK dependency** (ADR-001). `@opentelemetry/api` is a peer dependency only,
   never a direct one. No `@opentelemetry/sdk-*` packages. New runtime dependencies need an ADR.
3. **Never pass vacuously** (ADR-001). Zero captured `gen_ai` spans, unrecorded content, or
   still-open spans fail loudly with an explicit error type — never a silent green.
4. **No surprise spend** (ADR-003). Nothing calls a real model without an explicit budget.
   `pnpm check` and CI never make live API calls. No API keys, auth headers or real personal data
   in the repo, cassettes included.
5. **Honest statistics** (ADR-002). A pass rate is an observed rate, never "the probability the
   agent works". The interval is always printed. Errored runs are not failures.

## Code style

- TypeScript strict; no `any` (use `unknown` + type guards); no non-null assertions without a reason.
- Functional style where practical; classes for domain models only when they earn it.
  KISS and YAGNI beat speculative abstraction.
- Runner-agnostic core, thin runner adapters (ADR-004). The core never imports vitest or Playwright.
- Small focused modules, flat structure. Tests co-located: `foo.ts` → `foo.test.ts`.
- Relative imports use the `.js` extension (NodeNext resolution).
- Fail fast with explicit error types; never swallow errors.
- Everything in the repo is in English: code, comments, commits, PRs, docs. One deliberate
  exception: the maintainer's Russian trigger phrases in the `sync` skill ("ОК ЖАБА", "смержил").

## Workflow

Small, reviewable steps. Never work for long stretches without checking in.

**Size budget:** one PR = one thing — a module, a matcher set, a config, or docs. Aim for
≤ ~300 changed lines (lockfiles excluded) and ≤ ~15 minutes of work. Post a 3–5 line plan before
starting; if work runs past ~15 minutes, stop and report where you are. A feature is a chain of
PRs. Review fixes: 1–2 findings per PR.

1. One task = one branch: `<type>/<milestone>-<topic>` (`feat/m1-span-collector`,
   `fix/matcher-diff-output`, `chore/m0-ci-matrix`).
2. Test first, then a small code change, then `pnpm check`.
3. Record notable decisions as a new ADR in `docs/adr/`.
4. `/ship` — commit, push, open a PR. **Never merge; the maintainer merges.**
5. After the maintainer merges: `/sync` — back to an up-to-date `main`.
6. Review cadence: `pnpm check` runs on every PR in CI. The `toad-reviewer` agent reviews what
   changed since the last `review/*` tag at the end of each milestone, with fresh context.
   After the review, tag the merge commit `review/<milestone>`.
