import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { RecordingTracer, RUN_KEY } from './recording-tracer.js';

describe('RecordingTracer', () => {
  it('records a span only when it ends', () => {
    const tracer = new RecordingTracer();
    const span = tracer.startSpan('chat model', {
      kind: SpanKind.CLIENT,
      attributes: { 'gen_ai.operation.name': 'chat' },
    });
    expect(tracer.getFinishedSpans()).toHaveLength(0);
    span.end();
    const [recorded] = tracer.getFinishedSpans();
    expect(recorded?.name).toBe('chat model');
    expect(recorded?.kind).toBe(SpanKind.CLIENT);
    expect(recorded?.attributes).toEqual({ 'gen_ai.operation.name': 'chat' });
    expect(recorded?.endTime).toBeDefined();
  });

  it('takes the parent and trace id from the given context', () => {
    const tracer = new RecordingTracer();
    const parent = tracer.startSpan('invoke_agent');
    const child = tracer.startSpan('chat', {}, trace.setSpan(ROOT_CONTEXT, parent));
    expect(child.spanContext().traceId).toBe(parent.spanContext().traceId);
    child.end();
    expect(tracer.getFinishedSpans()[0]?.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
  });

  it('ignores the parent when root: true', () => {
    const tracer = new RecordingTracer();
    const parent = tracer.startSpan('outer');
    const span = tracer.startSpan('inner', { root: true }, trace.setSpan(ROOT_CONTEXT, parent));
    span.end();
    expect(tracer.getFinishedSpans()[0]?.parentSpanContext).toBeUndefined();
    expect(span.spanContext().traceId).not.toBe(parent.spanContext().traceId);
  });

  it('tags a span with the run id from its start context', () => {
    const tracer = new RecordingTracer();
    tracer.startSpan('tagged', {}, ROOT_CONTEXT.setValue(RUN_KEY, 'run-1')).end();
    tracer.startSpan('untagged', {}, ROOT_CONTEXT).end();
    tracer.startSpan('not-a-string', {}, ROOT_CONTEXT.setValue(RUN_KEY, 42)).end();
    expect(tracer.getFinishedSpans().map((s) => [s.name, s.runId])).toEqual([
      ['tagged', 'run-1'],
      ['untagged', undefined],
      ['not-a-string', undefined],
    ]);
  });

  it('freezes attributes, events and status after end()', () => {
    const tracer = new RecordingTracer();
    const span = tracer.startSpan('s');
    span.setAttribute('a', 1).setStatus({ code: SpanStatusCode.OK });
    span.end();
    span.setAttribute('b', 2).setAttributes({ c: 3 }).addEvent('late').setStatus({ code: SpanStatusCode.ERROR });
    const [recorded] = tracer.getFinishedSpans();
    expect(recorded?.attributes).toEqual({ a: 1 });
    expect(recorded?.events).toEqual([]);
    expect(recorded?.status.code).toBe(SpanStatusCode.OK);
    expect(span.isRecording()).toBe(false);
  });

  it('records a span once even if end() is called twice', () => {
    const tracer = new RecordingTracer();
    const span = tracer.startSpan('s');
    span.end();
    span.end();
    expect(tracer.getFinishedSpans()).toHaveLength(1);
  });

  it('drops undefined attribute values', () => {
    const tracer = new RecordingTracer();
    const span = tracer.startSpan('s', { attributes: { kept: 'x', dropped: undefined } });
    span.end();
    expect(tracer.getFinishedSpans()[0]?.attributes).toEqual({ kept: 'x' });
  });

  it('records exceptions as events', () => {
    const tracer = new RecordingTracer();
    const span = tracer.startSpan('s');
    span.recordException(new TypeError('boom'));
    span.recordException('plain message');
    span.end();
    expect(tracer.getFinishedSpans()[0]?.events).toEqual([
      { name: 'exception', attributes: { 'exception.type': 'TypeError', 'exception.message': 'boom' } },
      { name: 'exception', attributes: { 'exception.message': 'plain message' } },
    ]);
  });

  it('startActiveSpan passes the span to fn and returns its result', () => {
    const tracer = new RecordingTracer();
    const result = tracer.startActiveSpan('active', { kind: SpanKind.INTERNAL }, (span) => {
      span.end();
      return 'done';
    });
    expect(result).toBe('done');
    expect(tracer.getFinishedSpans()[0]?.name).toBe('active');
  });
});
