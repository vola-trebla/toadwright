/**
 * A minimal OpenTelemetry `Tracer` that records finished spans in memory.
 *
 * It depends only on `@opentelemetry/api`, so toadwright never pulls an SDK that could conflict with
 * the app's SDK 2.x / 3.x line (ADR-001). It is never registered globally.
 */
import { randomBytes } from 'node:crypto';
import {
  type Attributes,
  type AttributeValue,
  type Context,
  context as contextApi,
  createContextKey,
  type Exception,
  type HrTime,
  type Link,
  type Span,
  type SpanContext,
  SpanKind,
  type SpanOptions,
  type SpanStatus,
  SpanStatusCode,
  type TimeInput,
  TraceFlags,
  type Tracer,
  trace,
} from '@opentelemetry/api';

/** Context key that tags every span started inside one toadwright run (ADR-001, decision 3). */
export const RUN_KEY = createContextKey('toadwright.run');

export interface SpanEvent {
  readonly name: string;
  readonly attributes?: Attributes;
}

/** Read-only view of a finished span. */
export interface RecordedSpan {
  readonly name: string;
  readonly kind: SpanKind;
  readonly parentSpanContext: SpanContext | undefined;
  /** Run id read from the context the span was started in. */
  readonly runId: string | undefined;
  readonly attributes: Readonly<Attributes>;
  readonly events: readonly SpanEvent[];
  readonly status: SpanStatus;
  readonly startTime: HrTime;
  readonly endTime: HrTime | undefined;
  spanContext(): SpanContext;
}

const now = (): HrTime => {
  const ns = process.hrtime.bigint();
  return [Number(ns / 1_000_000_000n), Number(ns % 1_000_000_000n)];
};

const randomHex = (bytes: number) => randomBytes(bytes).toString('hex');

const isAttributes = (value: unknown): value is Attributes =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

class RecordingSpan implements Span, RecordedSpan {
  readonly attributes: Attributes = {};
  readonly events: SpanEvent[] = [];
  readonly startTime: HrTime = now();
  status: SpanStatus = { code: SpanStatusCode.UNSET };
  endTime: HrTime | undefined;
  private readonly ctx: SpanContext;

  constructor(
    public name: string,
    readonly kind: SpanKind,
    readonly parentSpanContext: SpanContext | undefined,
    readonly runId: string | undefined,
    private readonly onEnd: (span: RecordingSpan) => void,
  ) {
    this.ctx = {
      traceId: parentSpanContext?.traceId ?? randomHex(16),
      spanId: randomHex(8),
      traceFlags: TraceFlags.SAMPLED,
    };
  }

  spanContext(): SpanContext {
    return this.ctx;
  }

  isRecording(): boolean {
    return this.endTime === undefined;
  }

  setAttribute(key: string, value: AttributeValue): this {
    // `value` can still be undefined at runtime (setAttributes passes plain objects through).
    if (this.isRecording() && value !== undefined) this.attributes[key] = value;
    return this;
  }

  setAttributes(attributes: Attributes): this {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) this.setAttribute(key, value);
    }
    return this;
  }

  addEvent(name: string, attributesOrStartTime?: Attributes | TimeInput): this {
    if (!this.isRecording()) return this;
    this.events.push(isAttributes(attributesOrStartTime) ? { name, attributes: attributesOrStartTime } : { name });
    return this;
  }

  addLink(_link: Link): this {
    return this;
  }

  addLinks(_links: Link[]): this {
    return this;
  }

  setStatus(status: SpanStatus): this {
    if (this.isRecording()) this.status = status;
    return this;
  }

  updateName(name: string): this {
    if (this.isRecording()) this.name = name;
    return this;
  }

  recordException(exception: Exception): void {
    if (typeof exception === 'string') {
      this.addEvent('exception', { 'exception.message': exception });
      return;
    }
    const attributes: Attributes = {};
    if (exception.name !== undefined) attributes['exception.type'] = exception.name;
    if (exception.message !== undefined) attributes['exception.message'] = exception.message;
    this.addEvent('exception', attributes);
  }

  end(): void {
    if (!this.isRecording()) return;
    this.endTime = now();
    this.onEnd(this);
  }
}

export class RecordingTracer implements Tracer {
  private readonly finished: RecordedSpan[] = [];
  private readonly open = new Set<RecordedSpan>();

  /** Finished spans in the order they ended. */
  getFinishedSpans(): readonly RecordedSpan[] {
    return this.finished;
  }

  /** Spans started but not ended yet, in start order. */
  getOpenSpans(): readonly RecordedSpan[] {
    return [...this.open];
  }

  startSpan(name: string, options: SpanOptions = {}, ctx: Context = contextApi.active()): Span {
    const parent = options.root ? undefined : trace.getSpanContext(ctx);
    const runId = ctx.getValue(RUN_KEY);
    const span = new RecordingSpan(
      name,
      options.kind ?? SpanKind.INTERNAL,
      parent,
      typeof runId === 'string' ? runId : undefined,
      (s) => {
        this.open.delete(s);
        this.finished.push(s);
      },
    );
    if (options.attributes) span.setAttributes(options.attributes);
    this.open.add(span);
    return span;
  }

  startActiveSpan<F extends (span: Span) => unknown>(name: string, fn: F): ReturnType<F>;
  startActiveSpan<F extends (span: Span) => unknown>(name: string, options: SpanOptions, fn: F): ReturnType<F>;
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    options: SpanOptions,
    ctx: Context,
    fn: F,
  ): ReturnType<F>;
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    ...args: [F] | [SpanOptions, F] | [SpanOptions, Context, F]
  ): ReturnType<F> {
    const fn = args[args.length - 1] as F;
    const options = args.length >= 2 ? (args[0] as SpanOptions) : {};
    const parentCtx = args.length === 3 ? args[1] : contextApi.active();
    const span = this.startSpan(name, options, parentCtx);
    return contextApi.with(trace.setSpan(parentCtx, span), () => fn(span) as ReturnType<F>);
  }
}
