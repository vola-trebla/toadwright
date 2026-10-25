/**
 * ADR-001, finding 10, with the app's own context manager: the app registers
 * `AsyncLocalStorageContextManager` and its own tracer without NodeSDK, and toadwright's integration
 * is registered before the app's (the risky order). toadwright must keep the app's context manager,
 * and spans the app creates inside a tool must keep the app's tool span as parent.
 */
import { OpenTelemetry } from '@ai-sdk/otel';
import { context } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { registerTelemetry } from 'ai';
import { afterAll, describe, expect, it } from 'vitest';
import { captureDiag, globalState, PRISTINE, telemetryIntegrations } from '../__fixtures__/otel-globals.js';
import { describeTree } from '../__fixtures__/span-tree.js';
import { runSupportAgent, SUPPORT_AGENT_TREE } from '../__fixtures__/support-agent.js';
import { getCollector, hasWorkingContextManager } from '../collector.js';

// Each test file runs in its own worker: prove that nothing leaked in from another file.
const stateAtStart = globalState();
const diagMessages = captureDiag();

// 1. The app registers its own context manager at startup.
const appContextManager = new AsyncLocalStorageContextManager().enable();
const appRegisteredContextManager = context.setGlobalContextManager(appContextManager);

// 2. toadwright registers its integration before the app's.
const collector = getCollector();

// 3. The app wires AI SDK to its own tracer.
const exporter = new InMemorySpanExporter();
const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });
const appTracer = provider.getTracer('app');
const appIntegration = new OpenTelemetry({ tracer: appTracer });
registerTelemetry(appIntegration);

afterAll(async () => {
  await provider.shutdown();
  appContextManager.disable();
});

/** The app's DB call inside a tool: a span on the app's tracer, parented by the active context. */
const appDbCall = () => appTracer.startActiveSpan('db.query', (span) => span.end());

describe("app-registered context manager, toadwright's integration first", () => {
  it('starts from a clean worker, and the app owns the context manager', () => {
    expect(stateAtStart).toEqual(PRISTINE);
    expect(appRegisteredContextManager).toBe(true);
    expect(telemetryIntegrations()).toEqual([expect.any(OpenTelemetry), appIntegration]);
    expect(telemetryIntegrations()[0]).not.toBe(appIntegration);
  });

  it("uses the app's context manager instead of installing its own", async () => {
    const run = await collector.run('app cm', () => runSupportAgent({ orderId: 'M-1', onToolExecute: appDbCall }));
    expect(collector.installedContextManager).toBe(false);
    expect(hasWorkingContextManager()).toBe(true);
    // toadwright sees the gen_ai tree only; the app's DB spans are not gen_ai spans of the run.
    expect(describeTree(run.spans)).toEqual(SUPPORT_AGENT_TREE);
  });

  it("parents the app's spans inside tools on the app's tool span", async () => {
    exporter.reset();
    await provider.forceFlush();
    await collector.run('parentage', () => runSupportAgent({ orderId: 'M-2', onToolExecute: appDbCall }));
    await provider.forceFlush();
    expect(describeTree(exporter.getFinishedSpans())).toEqual([
      'invoke_agent mock-support-1',
      '  step 1',
      '    chat mock-support-1',
      '    execute_tool lookup_order',
      '      db.query',
      '  step 2',
      '    chat mock-support-1',
      '    execute_tool issue_refund',
      '      db.query',
      '  step 3',
      '    chat mock-support-1',
    ]);
  });

  it('emits no OTel diag warnings or errors', () => {
    expect(diagMessages).toEqual([]);
  });
});
