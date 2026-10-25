/** Read-only probes of process-wide OTel and AI SDK state, for the registration-order scenarios. */
import { DiagLogLevel, diag, ProxyTracerProvider, type TracerProvider, trace } from '@opentelemetry/api';
import { hasWorkingContextManager } from '../collector.js';

/** AI SDK's global telemetry integrations, in registration order. */
export const telemetryIntegrations = (): readonly unknown[] =>
  (globalThis as { AI_SDK_TELEMETRY_INTEGRATIONS?: unknown[] }).AI_SDK_TELEMETRY_INTEGRATIONS ?? [];

/** The provider behind the API's global proxy (a no-op one until an SDK registers). */
export function tracerProviderDelegate(): TracerProvider {
  const provider = trace.getTracerProvider();
  if (!(provider instanceof ProxyTracerProvider)) throw new Error('global tracer provider is not the API proxy');
  return provider.getDelegate();
}

/** Global state a fresh worker must start with: nothing registered by an earlier test file. */
export function globalState() {
  return {
    integrations: telemetryIntegrations().length,
    workingContextManager: hasWorkingContextManager(),
    tracerProvider: tracerProviderDelegate().constructor.name,
  };
}

export const PRISTINE = { integrations: 0, workingContextManager: false, tracerProvider: 'NoopTracerProvider' };

/** Routes OTel diag warnings and errors into an array. Acts as the app's logger, not toadwright's. */
export function captureDiag(): string[] {
  const messages: string[] = [];
  const push = (level: string) => (message: string) => messages.push(`${level} ${message}`);
  diag.setLogger(
    { error: push('error'), warn: push('warn'), info: () => {}, debug: () => {}, verbose: () => {} },
    DiagLogLevel.WARN,
  );
  return messages;
}
