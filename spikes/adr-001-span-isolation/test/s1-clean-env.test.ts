import { describe, expect, it } from 'vitest';
import { context, trace } from '@opentelemetry/api';
import { createCollector, describeTree } from '../src/collector';
import { runStreamingAgent, runSupportAgent } from '../src/agent';

const collector = await createCollector();

describe('S1 clean environment', () => {
  it('installs a context manager lazily, only because none existed', async () => {
    expect(collector.installedContextManager).toBeUndefined();
    await collector.run('warmup', () => runSupportAgent({ orderId: 'W-0' }));
    expect(collector.installedContextManager).toBe(true);
  });

  it('does not register a global tracer provider', () => {
    // ProxyTracerProvider delegates to a no-op when nothing was registered.
    const delegate = (trace.getTracerProvider() as unknown as { getDelegate(): object }).getDelegate();
    expect(delegate.constructor.name).toBe('NoopTracerProvider');
    expect(context).toBeDefined();
  });

  it('captures the full gen_ai tree under the test root span', async () => {
    const run = await collector.run('refund', () => runSupportAgent({ orderId: 'A-1' }));
    const tree = describeTree(run.spans, run.rootSpanId);
    console.log('S1 tree:\n' + tree.join('\n'));
    expect(tree).toEqual([
      'invoke_agent mock-support-1',
      '  step 1',
      '    chat mock-support-1',
      '    execute_tool lookup_order',
      '  step 2',
      '    chat mock-support-1',
      '    execute_tool issue_refund',
      '  step 3',
      '    chat mock-support-1',
    ]);
  });

  it('records standard attributes needed for trajectory assertions', async () => {
    const run = await collector.run('attrs', () => runSupportAgent({ orderId: 'A-2' }));
    const tools = run.spans.filter((s) => s.attributes['gen_ai.operation.name'] === 'execute_tool');
    expect(tools.map((s) => s.attributes['gen_ai.tool.name'])).toEqual(['lookup_order', 'issue_refund']);
    expect(JSON.parse(String(tools[1].attributes['gen_ai.tool.call.arguments']))).toEqual({ orderId: 'A-2', amount: 42 });
    expect(JSON.parse(String(tools[1].attributes['gen_ai.tool.call.result']))).toEqual({ orderId: 'A-2', refunded: 42 });
    const root = run.spans.find((s) => s.attributes['gen_ai.operation.name'] === 'invoke_agent')!;
    console.log('S1 root attributes:', Object.keys(root.attributes).sort().join(', '));
    expect(root.attributes['gen_ai.agent.name']).toBe('support-agent');
    expect(root.attributes['gen_ai.usage.input_tokens']).toBe(30);
    expect(root.attributes['gen_ai.usage.output_tokens']).toBe(15);
  });

  it('collects streamText spans once the stream is consumed', async () => {
    const run = await collector.run('stream', () => runStreamingAgent('S-1'));
    expect(run.result).toBe('streamed S-1');
    expect(describeTree(run.spans, run.rootSpanId)[0]).toBe('invoke_agent mock-stream-1');
  });
});
