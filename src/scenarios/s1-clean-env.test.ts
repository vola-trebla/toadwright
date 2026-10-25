/**
 * ADR-001, scenario S1: the app has no telemetry of its own.
 * toadwright captures the full gen_ai tree and writes nothing global but a context manager.
 */
import { propagation, trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { describeTree } from '../__fixtures__/span-tree.js';
import { runStreamingAgent, runSupportAgent, SUPPORT_AGENT_TREE } from '../__fixtures__/support-agent.js';
import { getCollector, hasWorkingContextManager } from '../collector.js';

const collector = getCollector();

describe('S1 clean environment', () => {
  // Runs first: the file's worker starts with no context manager at all.
  it('installs a context manager lazily, only because none existed', async () => {
    expect(hasWorkingContextManager()).toBe(false);
    expect(collector.installedContextManager).toBe(false);
    await collector.run('warm up', () => runSupportAgent({ orderId: 'W-0' }));
    expect(collector.installedContextManager).toBe(true);
    expect(hasWorkingContextManager()).toBe(true);
  });

  it('registers no global tracer provider or propagator', () => {
    const probe = trace.getTracer('s1-probe').startSpan('probe');
    expect(probe.isRecording()).toBe(false);
    expect(trace.isSpanContextValid(probe.spanContext())).toBe(false);
    probe.end();
    expect(propagation.fields()).toEqual([]);
  });

  it('captures the full gen_ai tree, every span tagged with the run id', async () => {
    const run = await collector.run('refund', () => runSupportAgent({ orderId: 'A-1' }));
    expect(run.result).toBe('Refund for A-1 issued.');
    expect(describeTree(run.spans)).toEqual(SUPPORT_AGENT_TREE);
    const runIds = new Set(run.spans.map((s) => s.runId));
    expect(runIds.size).toBe(1);
    expect([...runIds][0]).toEqual(expect.any(String));
  });

  it('records the standard attributes trajectory assertions need', async () => {
    const run = await collector.run('attributes', () => runSupportAgent({ orderId: 'A-2' }));
    const tools = run.spans.filter((s) => s.attributes['gen_ai.operation.name'] === 'execute_tool');
    expect(tools.map((s) => s.attributes['gen_ai.tool.name'])).toEqual(['lookup_order', 'issue_refund']);
    expect(JSON.parse(String(tools[1]?.attributes['gen_ai.tool.call.arguments']))).toEqual({
      orderId: 'A-2',
      amount: 42,
    });
    expect(JSON.parse(String(tools[1]?.attributes['gen_ai.tool.call.result']))).toEqual({
      orderId: 'A-2',
      refunded: 42,
    });
    const agent = run.spans.find((s) => s.attributes['gen_ai.operation.name'] === 'invoke_agent');
    expect(agent?.attributes['gen_ai.agent.name']).toBe('support-agent');
    expect(agent?.attributes['gen_ai.usage.input_tokens']).toBe(30);
    expect(agent?.attributes['gen_ai.usage.output_tokens']).toBe(15);
  });

  it('collects streamText spans once the stream is consumed', async () => {
    const run = await collector.run('stream', () => runStreamingAgent('S-1'));
    expect(run.result).toBe('streamed S-1');
    expect(describeTree(run.spans)[0]).toBe('invoke_agent mock-stream-1');
  });
});
