/**
 * Simulates an app's real OpenTelemetry bootstrap with `NodeSDK`, on whichever OTel line is
 * installed (CI swaps in the legacy line: sdk-node 0.2xx / SDK 2.x). Dev-only: toadwright itself
 * never depends on an SDK (ADR-001).
 */
import { OpenTelemetry } from '@ai-sdk/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { InMemorySpanExporter, type ReadableSpan, SimpleSpanProcessor } from '@opentelemetry/sdk-trace';
import { registerTelemetry } from 'ai';

export interface AppTelemetry {
  /** Spans the app exported so far (stands in for the app's OTLP backend). */
  exportedSpans(): Promise<ReadableSpan[]>;
  shutdown(): Promise<void>;
}

/**
 * Starts NodeSDK (global tracer provider, context manager, propagator) and registers the app's own
 * AI SDK telemetry integration on the global tracer — what a typical app does at startup.
 */
export function startAppTelemetry(): AppTelemetry {
  const exporter = new InMemorySpanExporter();
  const processor = new SimpleSpanProcessor({ exporter });
  const sdk = new NodeSDK({ spanProcessors: [processor], instrumentations: [] });
  sdk.start();
  registerTelemetry(new OpenTelemetry());
  return {
    // NodeSDK detects resources asynchronously; SimpleSpanProcessor exports only after that.
    exportedSpans: async () => {
      await processor.forceFlush();
      return exporter.getFinishedSpans();
    },
    shutdown: () => sdk.shutdown(),
  };
}
