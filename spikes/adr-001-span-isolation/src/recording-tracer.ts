/**
 * A minimal OTel `Tracer` that records spans in memory.
 * Depends ONLY on `@opentelemetry/api`, so toadwright never pulls an SDK
 * version that could conflict with the app's SDK 2.x / 3.x line.
 */
import {
  context as otelContext,
  SpanKind,
  SpanStatusCode,
  trace,
  TraceFlags,
  type Attributes,
  type AttributeValue,
  type Context,
  type Exception,
  type Link,
  type Span,
  type SpanContext,
  type SpanOptions,
  type SpanStatus,
  type TimeInput,
  type Tracer,
  createContextKey,
} from '@opentelemetry/api';
import { randomBytes } from 'node:crypto';

/** Context key that tags everything started inside one toadwright run. */
export const RUN_KEY = createContextKey('toadwright.run');

export interface RecordedSpan {
  name: string;
  kind: SpanKind;
  spanContext(): SpanContext;
  parentSpanContext?: SpanContext;
  /** Run id from the context the span was started in (ctx-key design). */
  runId?: string;
  attributes: Attributes;
  events: { name: string; attributes?: Attributes }[];
  status: SpanStatus;
  startTime: [number, number];
  endTime?: [number, number];
}

type HrTime = [number, number];
const now = (): HrTime => {
  const ns = process.hrtime.bigint();
  return [Number(ns / 1_000_000_000n), Number(ns % 1_000_000_000n)];
};
const hex = (bytes: number) => randomBytes(bytes).toString('hex');

class RecordingSpan implements Span, RecordedSpan {
  attributes: Attributes = {};
  events: { name: string; attributes?: Attributes }[] = [];
  status: SpanStatus = { code: SpanStatusCode.UNSET };
  startTime: HrTime = now();
  endTime?: HrTime;
  runId?: string;
  private readonly ctx: SpanContext;

  constructor(
    public name: string,
    public kind: SpanKind,
    public parentSpanContext: SpanContext | undefined,
    private readonly onEnd: (s: RecordingSpan) => void,
    attributes?: Attributes,
  ) {
    this.ctx = {
      traceId: parentSpanContext?.traceId ?? hex(16),
      spanId: hex(8),
      traceFlags: TraceFlags.SAMPLED,
    };
    if (attributes) this.setAttributes(attributes);
  }

  spanContext() { return this.ctx; }
  setAttribute(key: string, value: AttributeValue) {
    if (!this.endTime && value !== undefined) this.attributes[key] = value;
    return this;
  }
  setAttributes(attrs: Attributes) {
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined) this.setAttribute(k, v);
    return this;
  }
  addEvent(name: string, attrsOrTime?: Attributes | TimeInput) {
    const attributes = attrsOrTime && typeof attrsOrTime === 'object' && !Array.isArray(attrsOrTime) && !(attrsOrTime instanceof Date)
      ? (attrsOrTime as Attributes) : undefined;
    this.events.push({ name, attributes });
    return this;
  }
  addLink(_link: Link) { return this; }
  addLinks(_links: Link[]) { return this; }
  setStatus(status: SpanStatus) { this.status = status; return this; }
  updateName(name: string) { this.name = name; return this; }
  end() {
    if (this.endTime) return;
    this.endTime = now();
    this.onEnd(this);
  }
  isRecording() { return !this.endTime; }
  recordException(exception: Exception) {
    const e = typeof exception === 'string' ? { message: exception } : exception;
    this.addEvent('exception', { 'exception.message': e.message ?? '', 'exception.type': (e as Error).name ?? '' });
  }
}

export class RecordingTracer implements Tracer {
  private readonly finished: RecordedSpan[] = [];

  getFinishedSpans(): readonly RecordedSpan[] { return this.finished; }

  startSpan(name: string, options: SpanOptions = {}, ctx: Context = otelContext.active()): Span {
    const parent = options.root ? undefined : trace.getSpanContext(ctx);
    const span = new RecordingSpan(name, options.kind ?? SpanKind.INTERNAL, parent, (s) => this.finished.push(s), options.attributes);
    const runId = ctx.getValue(RUN_KEY);
    if (typeof runId === 'string') span.runId = runId;
    return span;
  }

  startActiveSpan<F extends (span: Span) => unknown>(name: string, ...args: unknown[]): ReturnType<F> {
    const fn = args.pop() as F;
    const [options, ctx] = args as [SpanOptions | undefined, Context | undefined];
    const parentCtx = ctx ?? otelContext.active();
    const span = this.startSpan(name, options, parentCtx);
    return otelContext.with(trace.setSpan(parentCtx, span), fn as (s: Span) => ReturnType<F>, undefined, span);
  }
}
