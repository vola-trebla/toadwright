/**
 * Spike prototype of the toadwright span collector.
 *
 * Design under test:
 * - A PRIVATE tracer (never registered globally) so the app's telemetry setup
 *   is never replaced. Two implementations:
 *     - 'recording' (candidate): API-only RecordingTracer, no SDK dependency.
 *     - 'sdk': OTel SDK 2.x BasicTracerProvider + InMemorySpanExporter.
 * - An extra AI SDK OpenTelemetry integration bound to the private tracer.
 *   registerTelemetry() appends, so it runs next to the app's integration.
 * - Per-test isolation: each test runs inside its own root span; we keep only
 *   spans that share that root span's trace id.
 * - A global context manager is installed lazily (first run) and only when
 *   none is active, so an app that bootstraps OTel at import time wins.
 */
import { context, createContextKey, type Span, type SpanContext, type Tracer } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { registerTelemetry } from 'ai';
import { OpenTelemetry } from '@ai-sdk/otel';
import { RecordingTracer } from './recording-tracer';

export interface SpanLike {
  name: string;
  attributes: Record<string, unknown>;
  spanContext(): SpanContext;
  parentSpanContext?: SpanContext;
  startTime: [number, number];
}

export interface CollectedRun<T> {
  result: T;
  traceId: string;
  rootSpanId: string;
  spans: SpanLike[];
  /** Root gen_ai spans that ended during this run but belong to another trace. */
  orphanGenAiSpans: SpanLike[];
}

export class NoSpansCollectedError extends Error {
  constructor(testName: string, orphans: number) {
    super(
      `toadwright: no gen_ai spans were collected for "${testName}". ` +
        (orphans > 0
          ? `${orphans} gen_ai span(s) ended in a different trace — async context was probably lost.`
          : 'Is AI SDK telemetry disabled (isEnabled: false) or overridden per call (telemetry.integrations)?'),
    );
    this.name = 'NoSpansCollectedError';
  }
}

const PROBE = createContextKey('toadwright.context-probe');

/** True when a real context manager propagates values through context.with(). */
export function hasWorkingContextManager(): boolean {
  return context.with(context.active().setValue(PROBE, true), () => context.active().getValue(PROBE) === true);
}

export interface Collector {
  run<T>(testName: string, fn: () => Promise<T>, opts?: { allowEmpty?: boolean }): Promise<CollectedRun<T>>;
  /** Whether toadwright had to install the global context manager. */
  readonly installedContextManager: boolean | undefined;
  readonly impl: 'recording' | 'sdk';
}

interface Backend { tracer(name: string): Tracer; finished(): readonly SpanLike[] }

async function createBackend(impl: 'recording' | 'sdk'): Promise<Backend> {
  if (impl === 'recording') {
    const t = new RecordingTracer();
    return { tracer: () => t, finished: () => t.getFinishedSpans() as readonly SpanLike[] };
  }
  // Legacy-line comparison only (SDK 2.x API); not installed on the modern (SDK 3.0) line.
  interface LegacySdk {
    BasicTracerProvider: new (cfg: { spanProcessors: unknown[] }) => { getTracer(name: string): Tracer };
    InMemorySpanExporter: new () => { getFinishedSpans(): unknown[] };
    SimpleSpanProcessor: new (exporter: unknown) => unknown;
  }
  const sdkModule = '@opentelemetry/sdk-trace-base';
  const { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } = (await import(sdkModule)) as LegacySdk;
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return { tracer: (n) => provider.getTracer(n), finished: () => exporter.getFinishedSpans() as unknown as SpanLike[] };
}

export async function createCollector(
  impl: 'recording' | 'sdk' = (process.env.TOADWRIGHT_IMPL as 'recording' | 'sdk') ?? 'recording',
): Promise<Collector> {
  const backend = await createBackend(impl);
  const testTracer = backend.tracer('toadwright');
  registerTelemetry(new OpenTelemetry({ tracer: backend.tracer('gen_ai') }));

  let installedContextManager: boolean | undefined;
  const ensureContextManager = () => {
    if (installedContextManager !== undefined) return;
    installedContextManager = hasWorkingContextManager()
      ? false
      : context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  };

  return {
    impl,
    get installedContextManager() { return installedContextManager; },
    async run(testName, fn, opts) {
      ensureContextManager();
      const startedAt = backend.finished().length;
      return testTracer.startActiveSpan(`toadwright.test ${testName}`, async (root: Span) => {
        let result;
        try {
          result = await fn();
        } finally {
          root.end();
        }
        const { traceId, spanId } = root.spanContext();
        const all = backend.finished();
        const spans = all.filter((s) => s.spanContext().traceId === traceId && s.spanContext().spanId !== spanId);
        const orphanGenAiSpans = all
          .slice(startedAt)
          .filter((s) => s.spanContext().traceId !== traceId && 'gen_ai.operation.name' in s.attributes)
          .filter((s) => s.parentSpanContext === undefined);
        if (!opts?.allowEmpty && !spans.some((s) => 'gen_ai.operation.name' in s.attributes)) {
          throw new NoSpansCollectedError(testName, orphanGenAiSpans.length);
        }
        return { result: result as Awaited<typeof result>, traceId, rootSpanId: spanId, spans, orphanGenAiSpans };
      });
    },
  };
}

/** Compact, test-friendly view of a span tree. */
export function describeTree(spans: SpanLike[], rootSpanId: string): string[] {
  const byParent = new Map<string, SpanLike[]>();
  for (const s of spans) {
    const p = s.parentSpanContext?.spanId ?? 'none';
    byParent.set(p, [...(byParent.get(p) ?? []), s]);
  }
  const lines: string[] = [];
  const walk = (parentId: string, depth: number) => {
    const children = (byParent.get(parentId) ?? []).sort(
      (a, b) => a.startTime[0] - b.startTime[0] || a.startTime[1] - b.startTime[1],
    );
    for (const c of children) {
      lines.push(`${'  '.repeat(depth)}${c.name}`);
      walk(c.spanContext().spanId, depth + 1);
    }
  };
  walk(rootSpanId, 0);
  return lines;
}
