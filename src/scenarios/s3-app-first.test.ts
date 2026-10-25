/**
 * ADR-001, scenario S3: the app bootstraps a real NodeSDK first, then toadwright registers.
 * The app must export exactly the spans it exports without toadwright, and keep its globals.
 */
import { OpenTelemetry } from '@ai-sdk/otel';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { startAppTelemetry } from '../__fixtures__/app-telemetry.js';
import {
  captureDiag,
  globalState,
  PRISTINE,
  telemetryIntegrations,
  tracerProviderDelegate,
} from '../__fixtures__/otel-globals.js';
import { describeTree, spanShape } from '../__fixtures__/span-tree.js';
import { runSupportAgent, SUPPORT_AGENT_TREE } from '../__fixtures__/support-agent.js';
import { getCollector } from '../collector.js';

// Each test file runs in its own worker: prove that nothing leaked in from another file.
const stateAtStart = globalState();

const diagMessages = captureDiag();
const app = startAppTelemetry();
const providerBefore = tracerProviderDelegate();
afterAll(() => app.shutdown());

// Baseline: what the app exports with no toadwright present. Same input → comparable attributes.
await runSupportAgent({ orderId: 'SAME' });
const baseline = spanShape(await app.exportedSpans());

const collector = getCollector();

describe('S3 app bootstraps NodeSDK first', () => {
  beforeEach(() => app.reset());

  it('starts from a clean worker', () => {
    expect(stateAtStart).toEqual(PRISTINE);
  });

  it('registers after the app: the app integration first, toadwright second', () => {
    const integrations = telemetryIntegrations();
    expect(integrations).toHaveLength(2);
    expect(integrations[0]).toBe(app.integration);
    expect(integrations[1]).toBeInstanceOf(OpenTelemetry);
    expect(integrations[1]).not.toBe(app.integration);
  });

  it('app exports identical spans: names, parents, attributes', async () => {
    const run = await collector.run('with app', () => runSupportAgent({ orderId: 'SAME' }));
    expect(baseline).toHaveLength(SUPPORT_AGENT_TREE.length);
    expect(spanShape(await app.exportedSpans())).toEqual(baseline);
    // toadwright's own copy has the same tree as in a clean environment.
    expect(describeTree(run.spans)).toEqual(SUPPORT_AGENT_TREE);
  });

  it("app's invoke_agent stays a true root", async () => {
    await collector.run('parentage', () => runSupportAgent({ orderId: 'X-2' }));
    const appRoot = (await app.exportedSpans()).find((s) => s.name.startsWith('invoke_agent'));
    expect(appRoot?.parentSpanContext).toBeUndefined();
  });

  it('keeps run state apart: each run and each export holds only its own spans', async () => {
    for (const orderId of ['R-1', 'R-2']) {
      app.reset();
      const run = await collector.run(orderId, () => runSupportAgent({ orderId }));
      const exported = await app.exportedSpans();
      expect(describeTree(exported)).toEqual(SUPPORT_AGENT_TREE);
      for (const spans of [run.spans, exported]) {
        const mentioned = new Set(JSON.stringify(spans.map((s) => s.attributes)).match(/\b[A-Z]-\d+\b/g));
        expect([...mentioned]).toEqual([orderId]);
      }
    }
  });

  it("keeps the app's context manager and global provider", () => {
    expect(collector.installedContextManager).toBe(false);
    expect(tracerProviderDelegate()).toBe(providerBefore);
  });

  it('emits no OTel diag warnings or errors', () => {
    expect(diagMessages).toEqual([]);
  });
});
