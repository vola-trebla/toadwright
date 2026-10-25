/**
 * ADR-001, scenario S5 — the worst-case order: toadwright runs a test before the app bootstraps
 * NodeSDK lazily. App telemetry must still work; the only cost is one diag error from NodeSDK.
 */
import { OpenTelemetry } from '@ai-sdk/otel';
import { afterAll, describe, expect, it } from 'vitest';
import { startAppTelemetry } from '../__fixtures__/app-telemetry.js';
import { captureDiag, globalState, PRISTINE, telemetryIntegrations } from '../__fixtures__/otel-globals.js';
import { describeTree } from '../__fixtures__/span-tree.js';
import { runSupportAgent, SUPPORT_AGENT_TREE } from '../__fixtures__/support-agent.js';
import { getCollector, hasWorkingContextManager } from '../collector.js';

// Each test file runs in its own worker: prove that nothing leaked in from another file.
const stateAtStart = globalState();

const diagMessages = captureDiag();
const collector = getCollector();
const early = await collector.run('before app', () => runSupportAgent({ orderId: 'E-1' }));
const installedBeforeApp = collector.installedContextManager;
const app = startAppTelemetry();
afterAll(() => app.shutdown());

describe('S5 toadwright first, app bootstraps NodeSDK later', () => {
  it('starts from a clean worker', () => {
    expect(stateAtStart).toEqual(PRISTINE);
  });

  it('registers before the app: toadwright first, the app integration second', () => {
    const integrations = telemetryIntegrations();
    expect(integrations).toHaveLength(2);
    expect(integrations[0]).toBeInstanceOf(OpenTelemetry);
    expect(integrations[0]).not.toBe(app.integration);
    expect(integrations[1]).toBe(app.integration);
  });

  it('installed its context manager before the app started, and collected the early run', () => {
    expect(installedBeforeApp).toBe(true);
    expect(describeTree(early.spans)).toEqual(SUPPORT_AGENT_TREE);
  });

  it('app telemetry still works: full tree with intact parents, run captured too', async () => {
    const run = await collector.run('after app', () => runSupportAgent({ orderId: 'L-1' }));
    expect(describeTree(run.spans)).toEqual(SUPPORT_AGENT_TREE);
    expect(describeTree(await app.exportedSpans())).toEqual(SUPPORT_AGENT_TREE);
    expect(hasWorkingContextManager()).toBe(true);
  });

  it('logs exactly one duplicate-registration error, nothing else', () => {
    expect(diagMessages).toHaveLength(1);
    expect(diagMessages[0]).toMatch(/^error .*duplicate registration of API: context/);
  });
});
