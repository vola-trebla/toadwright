// Smoke test for the NodeSDK fixture itself, so a broken OTel line in CI shows up here and not as a
// confusing failure in the registration-order scenarios. No toadwright involved.
import { trace } from '@opentelemetry/api';
import { afterAll, expect, it } from 'vitest';
import { startAppTelemetry } from './app-telemetry.js';
import { describeTree } from './span-tree.js';
import { runSupportAgent, SUPPORT_AGENT_TREE } from './support-agent.js';

const app = startAppTelemetry();
afterAll(() => app.shutdown());

it('NodeSDK records and exports the app gen_ai tree', async () => {
  expect(trace.getTracer('probe').startSpan('probe').isRecording()).toBe(true);
  await runSupportAgent({ orderId: 'N-1' });
  expect(describeTree(await app.exportedSpans())).toEqual(SUPPORT_AGENT_TREE);
});
