/**
 * ADR-001, scenario S4: setups that would make a test pass vacuously must fail loudly instead.
 * Unrecorded content has no error type yet (ContentNotRecordedError lands with the matchers), so
 * this checks the raw spans: the structure is there, the content is not.
 */
import { context, ROOT_CONTEXT } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { describeTree } from '../__fixtures__/span-tree.js';
import { runSupportAgent, SUPPORT_AGENT_TREE } from '../__fixtures__/support-agent.js';
import { getCollector, NoSpansCollectedError } from '../collector.js';

const collector = getCollector();

/** Attributes that carry recorded prompts, messages, tool arguments or results. */
const CONTENT_ATTRIBUTES = [
  'gen_ai.input.messages',
  'gen_ai.output.messages',
  'gen_ai.tool.call.arguments',
  'gen_ai.tool.call.result',
  'gen_ai.tool.definitions',
];

const attributeKeys = (spans: readonly { attributes: Readonly<Record<string, unknown>> }[]) =>
  new Set(spans.flatMap((s) => Object.keys(s.attributes)));

describe('S4 failure modes', () => {
  it('telemetry disabled per call → NoSpansCollectedError naming the cause', async () => {
    const run = collector.run('disabled', () => runSupportAgent({ orderId: 'D-1', telemetry: { isEnabled: false } }));
    await expect(run).rejects.toBeInstanceOf(NoSpansCollectedError);
    await expect(run).rejects.toThrow(/telemetry disabled/);
  });

  it('per-call integrations override the global ones → NoSpansCollectedError naming the cause', async () => {
    const run = collector.run('override', () => runSupportAgent({ orderId: 'O-1', telemetry: { integrations: [] } }));
    await expect(run).rejects.toBeInstanceOf(NoSpansCollectedError);
    await expect(run).rejects.toThrow(/overridden per call/);
  });

  it('lost async context → NoSpansCollectedError naming the orphan spans', async () => {
    const run = collector.run('lost context', () =>
      context.with(ROOT_CONTEXT, () => runSupportAgent({ orderId: 'L-1' })),
    );
    await expect(run).rejects.toBeInstanceOf(NoSpansCollectedError);
    await expect(run).rejects.toThrow(/ended outside any run — async context was probably lost/);
  });

  it('recordInputs/recordOutputs: false → full span tree, but no recorded content', async () => {
    // Control: with recording on, every content attribute is present, so the check below can fail.
    const recorded = await collector.run('recorded', () => runSupportAgent({ orderId: 'N-1' }));
    expect([...attributeKeys(recorded.spans)]).toEqual(expect.arrayContaining(CONTENT_ATTRIBUTES));

    const run = await collector.run('not recorded', () =>
      runSupportAgent({ orderId: 'N-2', telemetry: { recordInputs: false, recordOutputs: false } }),
    );
    expect(describeTree(run.spans)).toEqual(SUPPORT_AGENT_TREE);
    const tools = run.spans.filter((s) => s.attributes['gen_ai.operation.name'] === 'execute_tool');
    expect(tools.map((s) => s.attributes['gen_ai.tool.name'])).toEqual(['lookup_order', 'issue_refund']);
    const keys = attributeKeys(run.spans);
    expect(CONTENT_ATTRIBUTES.filter((key) => keys.has(key))).toEqual([]);
  });
});
