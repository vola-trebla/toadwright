import { type Attributes, type HrTime, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { runStreamingAgent, runSupportAgent } from './__fixtures__/support-agent.js';
import { toAgentTrace } from './agent-trace.js';
import { getCollector } from './collector.js';
import type { RecordedSpan } from './recording-tracer.js';

/** A hand-built finished span. `start` orders siblings; `parent` links by span id. */
function span(id: string, attributes: Attributes, start: number, parent?: string): RecordedSpan {
  const time: HrTime = [1_700_000_000, start];
  return {
    name: String(attributes['gen_ai.operation.name'] ?? 'span'),
    kind: SpanKind.INTERNAL,
    parentSpanContext: parent === undefined ? undefined : { traceId: 't'.repeat(32), spanId: parent, traceFlags: 1 },
    runId: 'run',
    attributes,
    events: [],
    status: { code: SpanStatusCode.UNSET },
    startTime: time,
    endTime: time,
    spanContext: () => ({ traceId: 't'.repeat(32), spanId: id, traceFlags: 1 }),
  };
}

const agent = (id: string, start: number, parent?: string) =>
  span(id, { 'gen_ai.operation.name': 'invoke_agent' }, start, parent);
const step = (id: string, start: number, parent: string) =>
  span(id, { 'gen_ai.operation.name': 'agent_step' }, start, parent);
const toolSpan = (id: string, name: string, start: number, parent?: string, extra: Attributes = {}) =>
  span(id, { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': name, ...extra }, start, parent);

describe('toAgentTrace', () => {
  it('normalizes a support agent run into agent → steps → model and tool calls', async () => {
    const { spans } = await getCollector().run('trace', () => runSupportAgent({ orderId: 'T-1' }));
    const trace = toAgentTrace(spans);

    expect(trace.agents).toHaveLength(1);
    const [support] = trace.agents;
    expect(support).toMatchObject({ name: 'support-agent', requestModel: 'mock-support-1', finishReasons: ['stop'] });
    expect(support?.steps.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(support?.steps.map((s) => s.toolCalls.map((t) => t.name))).toEqual([['lookup_order'], ['issue_refund'], []]);
    expect(support?.steps.map((s) => s.modelCalls.map((m) => m.finishReasons))).toEqual([
      [['tool-calls']],
      [['tool-calls']],
      [['stop']],
    ]);
    expect(support?.steps[0]?.modelCalls[0]).toEqual({
      provider: 'mock',
      requestModel: 'mock-support-1',
      responseModel: 'mock-support-1',
      finishReasons: ['tool-calls'],
    });

    expect(trace.toolCalls).toEqual([
      {
        name: 'lookup_order',
        callId: 'c1-T-1',
        args: { recorded: true, value: { orderId: 'T-1' } },
        result: { recorded: true, value: { orderId: 'T-1', total: 42 } },
      },
      {
        name: 'issue_refund',
        callId: 'c2-T-1',
        args: { recorded: true, value: { orderId: 'T-1', amount: 42 } },
        result: { recorded: true, value: { orderId: 'T-1', refunded: 42 } },
      },
    ]);
    expect(trace.modelCalls).toHaveLength(3);
  });

  it('normalizes a streamed run', async () => {
    const { spans } = await getCollector().run('stream', () => runStreamingAgent('T-2'));
    const trace = toAgentTrace(spans);
    expect(trace.agents.map((a) => a.steps.length)).toEqual([1]);
    expect(trace.modelCalls.map((m) => m.requestModel)).toEqual(['mock-stream-1']);
    expect(trace.toolCalls).toEqual([]);
  });

  it('tells unrecorded content apart from recorded content', async () => {
    const { spans } = await getCollector().run('no content', () =>
      runSupportAgent({ orderId: 'T-3', telemetry: { recordInputs: false, recordOutputs: false } }),
    );
    const [lookup] = toAgentTrace(spans).toolCalls;
    expect(lookup).toEqual({
      name: 'lookup_order',
      callId: 'c1-T-3',
      args: { recorded: false },
      result: { recorded: false },
    });
  });

  it('keeps content that is not JSON as the raw string', () => {
    const trace = toAgentTrace([
      toolSpan('a', 'search', 1, undefined, {
        'gen_ai.tool.call.arguments': 'not json',
        'gen_ai.tool.call.result': '',
      }),
    ]);
    expect(trace.toolCalls[0]?.args).toEqual({ recorded: true, value: 'not json' });
    expect(trace.toolCalls[0]?.result).toEqual({ recorded: true, value: '' });
  });

  it('orders by start time, not by the order spans ended in', () => {
    // Spans arrive in end order: the slower first tool ends last.
    const trace = toAgentTrace([
      toolSpan('t2', 'second', 30, 's1'),
      toolSpan('t1', 'first', 20, 's1'),
      step('s1', 10, 'root'),
      agent('root', 0),
    ]);
    expect(trace.toolCalls.map((t) => t.name)).toEqual(['first', 'second']);
    expect(trace.agents[0]?.steps[0]?.toolCalls.map((t) => t.name)).toEqual(['first', 'second']);
  });

  it('lists every agent, nested ones as separate agents (ADR-001, finding 11)', () => {
    // The nested agent's parent is the app's tool span, which toadwright never records.
    const trace = toAgentTrace([agent('outer', 0), step('s1', 1, 'outer'), agent('inner', 2, 'app-tool-span')]);
    expect(trace.agents).toHaveLength(2);
    expect(trace.agents.map((a) => a.steps.length)).toEqual([1, 0]);
  });

  it('keeps tool calls outside any agent or step in the flat list', () => {
    const trace = toAgentTrace([toolSpan('lonely', 'ping', 0)]);
    expect(trace.agents).toEqual([]);
    expect(trace.toolCalls.map((t) => t.name)).toEqual(['ping']);
  });

  it('ignores spans that are not gen_ai operations it knows', () => {
    const trace = toAgentTrace([
      span('db', { 'db.system': 'postgres' }, 0),
      span('e', { 'gen_ai.operation.name': 'embeddings' }, 1),
    ]);
    expect(trace).toEqual({ agents: [], modelCalls: [], toolCalls: [] });
  });
});
