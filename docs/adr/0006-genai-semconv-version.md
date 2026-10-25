# ADR-006: Pinned GenAI semantic conventions version

- **Status:** Accepted
- **Date:** 2026-10-25

## Context

toadwright reads `gen_ai.*` span attributes, and the GenAI conventions are still *Development*:
names and span shapes change between releases. Two facts as of 2026-10-25:

- Semantic conventions **v1.42.0** moved the GenAI conventions out of the core repo into
  [`semantic-conventions-genai`](https://github.com/open-telemetry/semantic-conventions-genai),
  which has **no release yet**. Its pending breaking changes (`gen_ai.request.top_k` type,
  `gen_ai.agent.id` / `gen_ai.provider.name` / `gen_ai.agent.version` removed from the internal
  `invoke_agent` span, text-only `gen_ai.system_instructions`) touch nothing toadwright reads.
- AI SDK 7 (`@ai-sdk/otel` 1.0.150) emits the **v1.41.0** shape: `invoke_agent` as an internal span
  without `gen_ai.response.id` / `gen_ai.response.model` (the v1.41 split), cache-token attributes
  (v1.40), `gen_ai.request.stream` (v1.41). It does not set `error.type`; failed spans get status
  `ERROR` and an `exception` event.

## Decision

- Pin **semantic conventions v1.41.0**, the last core release that defines the GenAI conventions.
  Move to a `semantic-conventions-genai` release once one exists and AI SDK follows it.
- All attribute names, operation names and the pinned version live in **one module**,
  `src/semconv.ts`. No other module spells a `gen_ai.*` name.
- No `@opentelemetry/semantic-conventions` dependency (ADR-001): the module holds its own string
  constants. GenAI names live only in its unstable `incubating` entry point anyway.
- Vendor extensions are marked as such in the module. AI SDK's `step N` spans carry
  `gen_ai.operation.name = "agent_step"`, which is not a semconv operation.
- A test runs the AI SDK support agent and checks that every mapped attribute appears on the span
  type it is mapped for, so an AI SDK upgrade that renames an attribute fails in CI, not in a user's
  test.

## Consequences

- ✅ A semconv rename is a one-module change, caught by the mapping test.
- ✅ The supported version is stated, not implied.
- ⚠️ Instrumentations on other semconv versions may not match until M4 adapters exist.
- ⚠️ The pin must be revisited when `semantic-conventions-genai` publishes its first release.
