import { trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { runSupportAgent } from '../src/agent';
import { createCollector, describeTree, spanShape } from '../src/collector';
import { captureDiag, diagMessages, startApp } from './app-bootstrap';
import { SUPPORT_AGENT_TREE } from './expected';

captureDiag();
const { appExporter, appSpans } = startApp();
const providerBefore = (trace.getTracerProvider() as unknown as { getDelegate(): unknown }).getDelegate();

// Baseline: what the app exports with no toadwright present. Same input → comparable attributes.
await runSupportAgent({ orderId: 'SAME' });
const baseline = spanShape(await appSpans());
appExporter.reset();

const collector = await createCollector();

describe(`S3 app bootstraps NodeSDK first [${collector.design}]`, () => {
  it('app exports identical spans: names, parents, attributes', async () => {
    const run = await collector.run('with-app', () => runSupportAgent({ orderId: 'SAME' }));
    expect(baseline).toHaveLength(9);
    expect(spanShape(await appSpans())).toEqual(baseline);
    // toadwright's own copy has the same tree as in a clean environment.
    expect(describeTree(run.spans)).toEqual(SUPPORT_AGENT_TREE);
  });

  it("app's invoke_agent stays a true root", async () => {
    appExporter.reset();
    await collector.run('parentage', () => runSupportAgent({ orderId: 'X-2' }));
    const appRoot = (await appSpans()).find((s) => s.name.startsWith('invoke_agent'));
    expect(appRoot?.parentSpanContext).toBeUndefined();
  });

  it('keeps the app context manager and global provider', () => {
    expect(collector.installedContextManager).toBe(false);
    const delegate = (trace.getTracerProvider() as unknown as { getDelegate(): unknown }).getDelegate();
    expect(delegate).toBe(providerBefore);
  });

  it('emits no OTel diag warnings or errors', () => {
    expect(diagMessages).toEqual([]);
  });
});
