/**
 * Span collector (ADR-001, as amended).
 *
 * - A private `RecordingTracer` is handed to AI SDK as an extra telemetry integration.
 *   `registerTelemetry` appends, so the app's own integrations keep working. The integration is
 *   passive: it never makes its spans active, so the app's spans keep the app's parents.
 * - Each run executes with a `toadwright.run` context value. The tracer tags every span with it,
 *   so toadwright creates no spans of its own and the app's span tree stays untouched.
 * - A context manager is installed only when none works, and nothing else global is written.
 */
import { randomUUID } from 'node:crypto';
import { setImmediate as nextMacrotask } from 'node:timers/promises';
import { OpenTelemetry } from '@ai-sdk/otel';
import { context, createContextKey } from '@opentelemetry/api';
import { registerTelemetry } from 'ai';
import { AsyncLocalStorageContextManager } from './context-manager.js';
import { type RecordedSpan, RecordingTracer, RUN_KEY, type RunSpans } from './recording-tracer.js';
import { ATTR } from './semconv.js';

export interface CollectedRun<T> {
  readonly result: T;
  /** Finished spans of this run, in the order they ended. */
  readonly spans: readonly RecordedSpan[];
}

export interface Collector {
  /** Runs `fn` in its own run context and returns its result with the spans it produced. */
  run<T>(testName: string, fn: () => T | Promise<T>): Promise<CollectedRun<T>>;
  /** True once toadwright had to install its own context manager. */
  readonly installedContextManager: boolean;
}

export class NoSpansCollectedError extends Error {
  override readonly name = 'NoSpansCollectedError';

  constructor(testName: string, orphans: number) {
    super(
      `toadwright: no gen_ai spans were collected for "${testName}". ` +
        (orphans > 0
          ? `${orphans} gen_ai span(s) ended outside any run — async context was probably lost.`
          : 'Is AI SDK telemetry disabled (isEnabled: false) or overridden per call (telemetry.integrations)?'),
    );
  }
}

export class OpenSpansError extends Error {
  override readonly name = 'OpenSpansError';

  constructor(
    testName: string,
    readonly openSpans: readonly RecordedSpan[],
  ) {
    super(
      `toadwright: ${openSpans.length} span(s) still open when "${testName}" returned ` +
        `(${openSpans.map((s) => s.name).join(', ')}) — did you consume the stream?`,
    );
  }
}

export class ContextManagerError extends Error {
  override readonly name = 'ContextManagerError';

  constructor() {
    super(
      'toadwright: a context manager is registered but does not propagate context.with(), and it cannot be ' +
        'replaced. Spans cannot be attributed to runs. Register a working one (e.g. NodeSDK does) or none.',
    );
  }
}

const isGenAi = (span: RecordedSpan) => ATTR.operationName in span.attributes;

const PROBE = createContextKey('toadwright.context-probe');

/** True when the global context manager propagates values through `context.with()`. */
export const hasWorkingContextManager = (): boolean =>
  context.with(context.active().setValue(PROBE, true), () => context.active().getValue(PROBE) === true);

/** Installs toadwright's context manager if none works. Returns true when it installed one. */
export function ensureContextManager(): boolean {
  if (hasWorkingContextManager()) return false;
  if (!context.setGlobalContextManager(new AsyncLocalStorageContextManager())) throw new ContextManagerError();
  return true;
}

/**
 * AI SDK nests `executeTool` / `executeLanguageModelCall` wrappers so that the integration
 * registered first runs innermost, and @ai-sdk/otel makes its own span active there. If toadwright
 * registered first, spans the app creates inside a tool or a provider call (HTTP, DB) would get a
 * toadwright span as parent, which is never exported (ADR-001, finding 10). Passing both through
 * keeps the active context the app's own. Toadwright's spans do not need it: @ai-sdk/otel parents
 * them from contexts it stores per call.
 */
class PassiveOpenTelemetry extends OpenTelemetry {
  override executeTool<T>({ execute }: { execute: () => PromiseLike<T> }): PromiseLike<T> {
    return execute();
  }

  override executeLanguageModelCall<T>({ execute }: { execute: () => PromiseLike<T> }): PromiseLike<T> {
    return execute();
  }
}

function createCollector(): Collector {
  const tracer = new RecordingTracer();
  registerTelemetry(new PassiveOpenTelemetry({ tracer }));
  let installedContextManager = false;

  return {
    get installedContextManager() {
      return installedContextManager;
    },

    async run<T>(testName: string, fn: () => T | Promise<T>): Promise<CollectedRun<T>> {
      // Checked per run, not at import: the app's SDK may start after toadwright is loaded.
      if (ensureContextManager()) installedContextManager = true;

      const runId = randomUUID();
      const untaggedBefore = tracer.untaggedRootSpanCount;
      tracer.beginRun(runId);
      let result: T;
      let taken: RunSpans;
      try {
        result = await context.with(context.active().setValue(RUN_KEY, runId), fn);
        // AI SDK starts spans asynchronously: let pending callbacks run so a stream the body never
        // awaited shows up as open spans instead of as "no spans". The promise form from
        // node:timers/promises is not replaced by fake timers, so vi.useFakeTimers() cannot hang it.
        await nextMacrotask();
      } finally {
        // Always forget the run, also when the body throws, so memory does not grow across runs.
        taken = tracer.takeRun(runId);
      }
      const { finished: spans, open } = taken;

      if (open.length > 0) throw new OpenSpansError(testName, open);
      if (!spans.some(isGenAi)) {
        // Root spans with no run id that ended meanwhile point at lost async context.
        throw new NoSpansCollectedError(testName, tracer.untaggedRootSpanCount - untaggedBefore);
      }
      return { result, spans };
    },
  };
}

// Kept on globalThis so that two copies of this module (e.g. src and dist) never register twice.
const COLLECTOR = Symbol.for('toadwright.collector');
type CollectorHolder = { [COLLECTOR]?: Collector };

/**
 * The process-wide collector. `registerTelemetry` cannot be undone, so there is exactly one per
 * process; it is created on first use.
 */
export function getCollector(): Collector {
  const holder = globalThis as CollectorHolder;
  holder[COLLECTOR] ??= createCollector();
  return holder[COLLECTOR];
}
