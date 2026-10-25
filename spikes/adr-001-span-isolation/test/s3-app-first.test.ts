import { describe, expect, it } from 'vitest';
import { trace } from '@opentelemetry/api';
import { captureDiag, diagMessages, spanNames, startApp } from './app-bootstrap';
import { runSupportAgent } from '../src/agent';
import { createCollector } from '../src/collector';

captureDiag();
const { appExporter, appSpans } = startApp();
const providerBefore = (trace.getTracerProvider() as unknown as { getDelegate(): unknown }).getDelegate();

// Baseline: what the app exports with no toadwright present.
await runSupportAgent({ orderId: 'BASE' });
const baseline = spanNames(await appSpans());
appExporter.reset();

const collector = await createCollector();

describe('S3 app bootstraps NodeSDK first', () => {
  it('app still exports exactly the same spans; toadwright gets its own copy', async () => {
    const run = await collector.run('with-app', () => runSupportAgent({ orderId: 'X-1' }));
    const withToadwright = await appSpans();
    console.log(`S3[${collector.impl}] baseline app spans: ${baseline.length} | with toadwright: ${withToadwright.length}`);
    expect(baseline.length).toBe(9);
    expect(spanNames(withToadwright)).toEqual(baseline);
    expect(run.spans.filter((s) => 'gen_ai.operation.name' in s.attributes)).toHaveLength(9);
  });

  it('keeps the app context manager and global provider', () => {
    expect(collector.installedContextManager).toBe(false);
    const delegate = (trace.getTracerProvider() as unknown as { getDelegate(): unknown }).getDelegate();
    expect(delegate).toBe(providerBefore);
  });

  it('documents cross-provider parentage (finding)', async () => {
    appExporter.reset();
    const run = await collector.run('parentage', () => runSupportAgent({ orderId: 'X-2' }));
    const appRoot = (await appSpans()).find((s) => s.name.startsWith('invoke_agent'))!;
    console.log(`S3[${collector.impl}] app root parented on toadwright test span: ${appRoot.parentSpanContext?.spanId === run.rootSpanId}`);
  });

  it('emits no OTel diag warnings or errors', () => {
    expect(diagMessages).toEqual([]);
  });
});
