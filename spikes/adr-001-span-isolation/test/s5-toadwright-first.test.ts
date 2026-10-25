import { describe, expect, it } from 'vitest';
import { captureDiag, diagMessages, spanNames, startApp } from './app-bootstrap';
import { runSupportAgent } from '../src/agent';
import { createCollector } from '../src/collector';

captureDiag();
// Worst case: toadwright runs a test BEFORE the app bootstraps OTel lazily.
const collector = await createCollector();
await collector.run('before-app', () => runSupportAgent({ orderId: 'EARLY' }));
const { appSpans } = startApp();

describe('S5 toadwright first, app bootstraps NodeSDK later', () => {
  it('toadwright installed the context manager', () => {
    expect(collector.installedContextManager).toBe(true);
  });

  it('app telemetry still works after the duplicate-registration attempt', async () => {
    const run = await collector.run('after-app', () => runSupportAgent({ orderId: 'LATE' }));
    expect(run.spans.filter((s) => 'gen_ai.operation.name' in s.attributes)).toHaveLength(9);
    expect(spanNames(await appSpans())).toHaveLength(9);
  });

  it('logs exactly one duplicate-registration error, nothing else (finding)', () => {
    expect(diagMessages).toHaveLength(1);
    expect(diagMessages[0]).toMatch(/duplicate registration of API: context/);
  });
});
