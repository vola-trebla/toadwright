/**
 * ADR-001, scenario S2: interleaved runs stay apart. Every span must belong to exactly the run that
 * produced it — not merely "no foreign run id", but the right run id, trace and order id.
 */
import { describe, expect, it } from 'vitest';
import { describeTree } from '../__fixtures__/span-tree.js';
import { runSupportAgent, SUPPORT_AGENT_TREE } from '../__fixtures__/support-agent.js';
import { type CollectedRun, getCollector } from '../collector.js';

const collector = getCollector();

/** Every order id (e.g. `P-7`) mentioned anywhere in a span's attributes. */
const orderIdsIn = (attributes: Readonly<Record<string, unknown>>): string[] =>
  JSON.stringify(attributes).match(/\b[A-Z]-\d+\b/g) ?? [];

/** Asserts that a run holds exactly the support agent's spans for `orderId`, and nothing else. */
function expectOwnedBy(run: CollectedRun<string>, orderId: string) {
  expect(run.result).toBe(`Refund for ${orderId} issued.`);
  expect(describeTree(run.spans)).toEqual(SUPPORT_AGENT_TREE);
  // No extra spans beyond the tree, and all of them are gen_ai spans.
  expect(run.spans).toHaveLength(SUPPORT_AGENT_TREE.length);
  expect(run.spans.every((s) => 'gen_ai.operation.name' in s.attributes)).toBe(true);
  // One run id and one trace for the whole run.
  expect(new Set(run.spans.map((s) => s.runId)).size).toBe(1);
  expect(new Set(run.spans.map((s) => s.spanContext().traceId)).size).toBe(1);
  // Each span that names an order names this run's order only.
  for (const span of run.spans) {
    for (const id of orderIdsIn(span.attributes)) expect(id, `${span.name} in run for ${orderId}`).toBe(orderId);
  }
  // The tool calls carry this run's order id.
  const toolArgs = run.spans.map((s) => s.attributes['gen_ai.tool.call.arguments']).filter((a) => a !== undefined);
  expect(toolArgs.map((a) => JSON.parse(String(a)).orderId)).toEqual([orderId, orderId]);
}

describe('S2 isolation', () => {
  it('50 interleaved runs in one Promise.all: each span belongs to its own run', async () => {
    const orderIds = Array.from({ length: 50 }, (_, i) => `P-${i}`);
    const runs = await Promise.all(
      orderIds.map((orderId) => collector.run(orderId, () => runSupportAgent({ orderId, jitterMs: 15 }))),
    );
    runs.forEach((run, i) => {
      expectOwnedBy(run, orderIds[i] ?? '');
    });
    // Run ids and traces are distinct across runs, so no span is shared by two runs.
    expect(new Set(runs.map((r) => r.spans[0]?.runId)).size).toBe(50);
    expect(new Set(runs.map((r) => r.spans[0]?.spanContext().traceId)).size).toBe(50);
    const spanIds = runs.flatMap((r) => r.spans.map((s) => s.spanContext().spanId));
    expect(new Set(spanIds).size).toBe(spanIds.length);
  });

  describe.concurrent('10 concurrent vitest tests', () => {
    for (let i = 0; i < 10; i++) {
      it(`concurrent test ${i}`, async () => {
        const orderId = `C-${i}`;
        const run = await collector.run(orderId, () => runSupportAgent({ orderId, jitterMs: 20 }));
        expectOwnedBy(run, orderId);
      });
    }
  });
});
