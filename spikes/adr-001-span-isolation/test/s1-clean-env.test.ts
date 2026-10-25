import { trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { runStreamingAgent, runSupportAgent } from '../src/agent';
import { createCollector, describeTree } from '../src/collector';
import { SUPPORT_AGENT_TREE } from './expected';

const collector = await createCollector();

describe(`S1 clean environment [${collector.design}]`, () => {
  it('installs a context manager lazily, only because none existed', async () => {
    expect(collector.installedContextManager).toBeUndefined();
    await collector.run('warmup', () => runSupportAgent({ orderId: 'W-0' }));
    expect(collector.installedContextManager).toBe(true);
  });

  it('does not register a global tracer provider', () => {
    const delegate = (trace.getTracerProvider() as unknown as { getDelegate(): object }).getDelegate();
    expect(delegate.constructor.name).toBe('NoopTracerProvider');
  });

  it('captures the full gen_ai tree', async () => {
    const run = await collector.run('refund', () => runSupportAgent({ orderId: 'A-1' }));
    expect(describeTree(run.spans)).toEqual(SUPPORT_AGENT_TREE);
  });

  it('records standard attributes needed for trajectory assertions', async () => {
    const run = await collector.run('attrs', () => runSupportAgent({ orderId: 'A-2' }));
    const tools = run.spans.filter((s) => s.attributes['gen_ai.operation.name'] === 'execute_tool');
    expect(tools.map((s) => s.attributes['gen_ai.tool.name'])).toEqual(['lookup_order', 'issue_refund']);
    expect(JSON.parse(String(tools[1]?.attributes['gen_ai.tool.call.arguments']))).toEqual({ orderId: 'A-2', amount: 42 });
    expect(JSON.parse(String(tools[1]?.attributes['gen_ai.tool.call.result']))).toEqual({ orderId: 'A-2', refunded: 42 });
    const root = run.spans.find((s) => s.attributes['gen_ai.operation.name'] === 'invoke_agent');
    expect(root?.attributes['gen_ai.agent.name']).toBe('support-agent');
    expect(root?.attributes['gen_ai.usage.input_tokens']).toBe(30);
    expect(root?.attributes['gen_ai.usage.output_tokens']).toBe(15);
  });

  it('collects streamText spans once the stream is consumed', async () => {
    const run = await collector.run('stream', () => runStreamingAgent('S-1'));
    expect(run.result).toBe('streamed S-1');
    expect(describeTree(run.spans)[0]).toBe('invoke_agent mock-stream-1');
  });
});
