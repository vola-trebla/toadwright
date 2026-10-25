import { context, INVALID_SPAN_CONTEXT, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AsyncLocalStorageContextManager } from './context-manager.js';
import { RecordingTracer, RUN_KEY } from './recording-tracer.js';

const RUN = ROOT_CONTEXT.setValue(RUN_KEY, 'run-1');

/** A tracer with run-1 open; `finished()` takes the run and returns its finished spans. */
function setup() {
  const tracer = new RecordingTracer();
  tracer.beginRun('run-1');
  return { tracer, finished: () => tracer.takeRun('run-1').finished };
}

describe('RecordingTracer', () => {
  it('records a span only when it ends', () => {
    const { tracer } = setup();
    const span = tracer.startSpan(
      'chat model',
      { kind: SpanKind.CLIENT, attributes: { 'gen_ai.operation.name': 'chat' } },
      RUN,
    );
    span.end();
    const { finished, open } = tracer.takeRun('run-1');
    expect(open).toHaveLength(0);
    expect(finished[0]?.name).toBe('chat model');
    expect(finished[0]?.kind).toBe(SpanKind.CLIENT);
    expect(finished[0]?.attributes).toEqual({ 'gen_ai.operation.name': 'chat' });
    expect(finished[0]?.endTime).toBeDefined();
  });

  it('tracks spans that have started but not ended', () => {
    const { tracer } = setup();
    tracer.startSpan('invoke_agent', {}, RUN);
    tracer.startSpan('chat', {}, RUN).end();
    const { finished, open } = tracer.takeRun('run-1');
    expect(open.map((s) => s.name)).toEqual(['invoke_agent']);
    expect(finished.map((s) => s.name)).toEqual(['chat']);
  });

  it('forgets a run once taken and drops its late spans', () => {
    const { tracer, finished } = setup();
    const late = tracer.startSpan('late', {}, RUN);
    expect(finished()).toHaveLength(0);
    late.end();
    expect(tracer.takeRun('run-1')).toEqual({ finished: [], open: [] });
  });

  it('stores no untagged spans, only counts untagged roots', () => {
    const { tracer, finished } = setup();
    const root = tracer.startSpan('untagged root', {}, ROOT_CONTEXT);
    tracer.startSpan('untagged child', {}, trace.setSpan(ROOT_CONTEXT, root)).end();
    root.end();
    tracer.startSpan('unknown run', {}, ROOT_CONTEXT.setValue(RUN_KEY, 'other')).end();
    tracer.startSpan('not-a-string', {}, ROOT_CONTEXT.setValue(RUN_KEY, 42)).end();
    expect(finished()).toHaveLength(0);
    expect(tracer.untaggedRootSpanCount).toBe(2);
  });

  it('takes the parent and trace id from the given context', () => {
    const { tracer, finished } = setup();
    const parent = tracer.startSpan('invoke_agent', {}, RUN);
    const child = tracer.startSpan('chat', {}, trace.setSpan(RUN, parent));
    expect(child.spanContext().traceId).toBe(parent.spanContext().traceId);
    child.end();
    expect(finished()[0]?.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
  });

  it('ignores the parent when root: true', () => {
    const { tracer, finished } = setup();
    const parent = tracer.startSpan('outer', {}, RUN);
    const span = tracer.startSpan('inner', { root: true }, trace.setSpan(RUN, parent));
    span.end();
    expect(finished()[0]?.parentSpanContext).toBeUndefined();
    expect(span.spanContext().traceId).not.toBe(parent.spanContext().traceId);
  });

  it('treats an invalid parent (no-op tracer span) as no parent', () => {
    const { tracer, finished } = setup();
    const span = tracer.startSpan('invoke_agent', {}, trace.setSpan(RUN, trace.wrapSpanContext(INVALID_SPAN_CONTEXT)));
    span.end();
    expect(finished()[0]?.parentSpanContext).toBeUndefined();
    expect(span.spanContext().traceId).not.toBe(INVALID_SPAN_CONTEXT.traceId);
  });

  it('tags a span with the run id from its start context', () => {
    const { tracer, finished } = setup();
    tracer.startSpan('tagged', {}, RUN).end();
    expect(finished().map((s) => [s.name, s.runId])).toEqual([['tagged', 'run-1']]);
  });

  it('records epoch timestamps', () => {
    const { tracer, finished } = setup();
    tracer.startSpan('s', {}, RUN).end();
    const [seconds] = finished()[0]?.startTime ?? [0];
    expect(Math.abs(seconds - Date.now() / 1000)).toBeLessThan(5);
  });

  it('freezes attributes, events and status after end()', () => {
    const { tracer, finished } = setup();
    const span = tracer.startSpan('s', {}, RUN);
    span.setAttribute('a', 1).setStatus({ code: SpanStatusCode.OK });
    span.end();
    span.setAttribute('b', 2).setAttributes({ c: 3 }).addEvent('late').setStatus({ code: SpanStatusCode.ERROR });
    const [recorded] = finished();
    expect(recorded?.attributes).toEqual({ a: 1 });
    expect(recorded?.events).toEqual([]);
    expect(recorded?.status.code).toBe(SpanStatusCode.OK);
    expect(span.isRecording()).toBe(false);
  });

  it('records a span once even if end() is called twice', () => {
    const { tracer, finished } = setup();
    const span = tracer.startSpan('s', {}, RUN);
    span.end();
    span.end();
    expect(finished()).toHaveLength(1);
  });

  it('drops undefined attribute values', () => {
    const { tracer, finished } = setup();
    tracer.startSpan('s', { attributes: { kept: 'x', dropped: undefined } }, RUN).end();
    expect(finished()[0]?.attributes).toEqual({ kept: 'x' });
  });

  it('records exceptions as events', () => {
    const { tracer, finished } = setup();
    const span = tracer.startSpan('s', {}, RUN);
    span.recordException(new TypeError('boom'));
    span.recordException('plain message');
    span.end();
    expect(finished()[0]?.events).toEqual([
      { name: 'exception', attributes: { 'exception.type': 'TypeError', 'exception.message': 'boom' } },
      { name: 'exception', attributes: { 'exception.message': 'plain message' } },
    ]);
  });

  describe('startActiveSpan', () => {
    beforeAll(() => context.setGlobalContextManager(new AsyncLocalStorageContextManager()));
    afterAll(() => context.disable());

    it('makes the span active inside fn for every overload and returns its result', () => {
      const { tracer, finished } = setup();
      const seen: boolean[] = [];
      const check = (span: ReturnType<RecordingTracer['startSpan']>) => {
        seen.push(trace.getActiveSpan() === span);
        span.end();
        return 'done';
      };
      const results = context.with(RUN, () => [
        tracer.startActiveSpan('two-arg', check),
        tracer.startActiveSpan('three-arg', { kind: SpanKind.INTERNAL }, check),
        tracer.startActiveSpan('four-arg', {}, RUN, check),
      ]);
      expect(results).toEqual(['done', 'done', 'done']);
      expect(seen).toEqual([true, true, true]);
      expect(finished().map((s) => s.name)).toEqual(['two-arg', 'three-arg', 'four-arg']);
    });
  });
});
