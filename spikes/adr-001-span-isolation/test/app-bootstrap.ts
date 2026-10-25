/** Simulates an app's real OTel bootstrap with NodeSDK. */
import { diag, DiagLogLevel } from '@opentelemetry/api';
import * as sdkNode from '@opentelemetry/sdk-node';

// sdk-node 0.2xx re-exports SDK 2.x as `tracing`; 0.300 (SDK 3.0) dropped it.
const legacyTracing = (sdkNode as Record<string, unknown>).tracing as typeof import('@opentelemetry/sdk-trace') | undefined;
const tracing = legacyTracing ?? (await import('@opentelemetry/sdk-trace'));
const { NodeSDK } = sdkNode;
import { registerTelemetry } from 'ai';
import { OpenTelemetry } from '@ai-sdk/otel';

export const diagMessages: string[] = [];
export function captureDiag() {
  diag.setLogger(
    { error: (m) => diagMessages.push(`error ${m}`), warn: (m) => diagMessages.push(`warn ${m}`), info() {}, debug() {}, verbose() {} },
    DiagLogLevel.WARN,
  );
}

export function startApp() {
  const appExporter = new tracing.InMemorySpanExporter(); // stands in for the app's OTLP exporter
  // SDK 2.x: new SimpleSpanProcessor(exporter). SDK 3.0: new SimpleSpanProcessor({ exporter }).
  const Proc = tracing.SimpleSpanProcessor as unknown as new (arg: unknown) => InstanceType<typeof tracing.SimpleSpanProcessor>;
  const processor = legacyTracing ? new Proc(appExporter) : new Proc({ exporter: appExporter });
  const sdk = new NodeSDK({
    spanProcessors: [processor],
    instrumentations: [],
  });
  sdk.start();
  registerTelemetry(new OpenTelemetry()); // app uses the global tracer
  // NodeSDK detects resources asynchronously; SimpleSpanProcessor waits for them before exporting.
  const appSpans = async () => { await processor.forceFlush(); return appExporter.getFinishedSpans(); };
  return { sdk, appExporter, appSpans };
}

export const spanNames = (spans: { name: string }[]) => spans.map((s) => s.name).sort();
