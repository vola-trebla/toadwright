/**
 * Spike prototype of the toadwright span collector.
 *
 * Two isolation designs (TOADWRIGHT_DESIGN):
 * - 'ctxkey' (candidate): the test body runs with a `toadwright.run` context value; the recording
 *   tracer tags every span with it. No toadwright span exists, so the app's span tree is untouched.
 * - 'rootspan' (ADR-001 as accepted): the test body runs inside a toadwright root span; spans are
 *   filtered by its trace id. The app's root gen_ai span gets an unexported parent.
 *
 * Common: private API-only RecordingTracer (never registered globally); an extra AI SDK integration
 * bound to it (registerTelemetry appends); a context manager installed lazily and only if missing.
 */
import { randomUUID } from 'node:crypto';
import { context, createContextKey, trace, type SpanContext } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { registerTelemetry } from 'ai';
import { OpenTelemetry } from '@ai-sdk/otel';
import { RecordingTracer, RUN_KEY, type RecordedSpan } from './recording-tracer';

export type Design = 'ctxkey' | 'rootspan';

export interface SpanLike {
  name: string;
  attributes: Record<string, unknown>;
  spanContext(): SpanContext;
  parentSpanContext?: SpanContext;
  startTime: [number, number];
}

export interface CollectedRun<T> {
  result: T;
  spans: SpanLike[];
  /** Root gen_ai spans that ended during this run but belong to no run (lost context). */
  orphanGenAiSpans: SpanLike[];
}

export class NoSpansCollectedError extends Error {
  constructor(testName: string, orphans: number) {
    super(
      `toadwright: no gen_ai spans were collected for "${testName}". ` +
        (orphans > 0
          ? `${orphans} gen_ai span(s) ended outside any run — async context was probably lost.`
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
  readonly installedContextManager: boolean | undefined;
  readonly design: Design;
}

const isGenAi = (s: SpanLike) => 'gen_ai.operation.name' in s.attributes;

export async function createCollector(
  design: Design = (process.env.TOADWRIGHT_DESIGN as Design | undefined) ?? 'ctxkey',
): Promise<Collector> {
  const tracer = new RecordingTracer();
  registerTelemetry(new OpenTelemetry({ tracer }));
  const finished = () => tracer.getFinishedSpans() as readonly (RecordedSpan & SpanLike)[];

  let installedContextManager: boolean | undefined;
  const ensureContextManager = () => {
    if (installedContextManager !== undefined) return;
    installedContextManager = hasWorkingContextManager()
      ? false
      : context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  };

  const collect = <T>(testName: string, result: T, belongs: (s: RecordedSpan) => boolean, startedAt: number, allowEmpty?: boolean) => {
    const all = finished();
    const spans = all.filter(belongs);
    const orphanGenAiSpans = all
      .slice(startedAt)
      .filter((s) => !belongs(s) && s.runId === undefined && isGenAi(s) && s.parentSpanContext === undefined);
    if (!allowEmpty && !spans.some(isGenAi)) throw new NoSpansCollectedError(testName, orphanGenAiSpans.length);
    return { result, spans, orphanGenAiSpans };
  };

  return {
    design,
    get installedContextManager() {
      return installedContextManager;
    },
    async run(testName, fn, opts) {
      ensureContextManager();
      const startedAt = finished().length;
      if (design === 'ctxkey') {
        const runId = randomUUID();
        const result = await context.with(context.active().setValue(RUN_KEY, runId), fn);
        return collect(testName, result, (s) => s.runId === runId, startedAt, opts?.allowEmpty);
      }
      const root = tracer.startSpan(`toadwright.test ${testName}`);
      let result: Awaited<ReturnType<typeof fn>>;
      try {
        result = await context.with(trace.setSpan(context.active(), root), fn);
      } finally {
        root.end();
      }
      const { traceId, spanId } = root.spanContext();
      const belongs = (s: RecordedSpan) => s.spanContext().traceId === traceId && s.spanContext().spanId !== spanId;
      return collect(testName, result, belongs, startedAt, opts?.allowEmpty);
    },
  };
}

/** Compact span tree. Roots are spans whose parent is not in the given set. */
export function describeTree(spans: SpanLike[]): string[] {
  const ids = new Set(spans.map((s) => s.spanContext().spanId));
  const byParent = new Map<string, SpanLike[]>();
  for (const s of spans) {
    const p = s.parentSpanContext && ids.has(s.parentSpanContext.spanId) ? s.parentSpanContext.spanId : 'root';
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
  walk('root', 0);
  return lines;
}

/** Per-call ids and wall-clock measurements differ between any two runs: not part of a span's shape. */
const VOLATILE_ATTRIBUTE = /(^gen_ai\.response\.id$|\.duration$|time_to_first_chunk$|time_per_output_chunk$)/;

/**
 * Comparable shape of an exported span: name, parent name (null = true root, '<unexported>' =
 * parent outside the exported set) and attributes. Span ids, timestamps and volatile attributes are excluded.
 */
export function spanShape(spans: SpanLike[]): string[] {
  const byId = new Map(spans.map((s) => [s.spanContext().spanId, s]));
  return spans
    .map((s) => {
      const p = s.parentSpanContext;
      const parent = p === undefined ? null : (byId.get(p.spanId)?.name ?? '<unexported>');
      const attrs = Object.fromEntries(
        Object.entries(s.attributes)
          .filter(([k]) => !VOLATILE_ATTRIBUTE.test(k))
          .sort(([a], [b]) => a.localeCompare(b)),
      );
      return JSON.stringify({ name: s.name, parent, attrs });
    })
    .sort();
}
