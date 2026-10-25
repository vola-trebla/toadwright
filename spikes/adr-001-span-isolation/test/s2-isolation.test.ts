import { describe, expect, it } from 'vitest';
import { createCollector } from '../src/collector';
import { runSupportAgent } from '../src/agent';

const collector = await createCollector();

function orderIdsIn(spans: { attributes: Record<string, unknown> }[]): Set<string> {
  const ids = new Set<string>();
  for (const s of spans) {
    const args = s.attributes['gen_ai.tool.call.arguments'];
    if (typeof args === 'string') ids.add(JSON.parse(args).orderId);
  }
  return ids;
}

describe('S2 isolation', () => {
  it('50 interleaved runs in one Promise.all never leak spans', async () => {
    const runs = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        collector.run(`run-${i}`, () => runSupportAgent({ orderId: `P-${i}`, jitterMs: 15 })),
      ),
    );
    runs.forEach((run, i) => {
      expect([...orderIdsIn(run.spans)]).toEqual([`P-${i}`]);
      expect(run.spans.filter((s) => 'gen_ai.operation.name' in s.attributes)).toHaveLength(9);
      expect(run.orphanGenAiSpans).toHaveLength(0);
    });
  });

  describe.concurrent('vitest test.concurrent', () => {
    for (let i = 0; i < 10; i++) {
      it(`concurrent test ${i}`, async () => {
        const run = await collector.run(`c-${i}`, () => runSupportAgent({ orderId: `C-${i}`, jitterMs: 20 }));
        expect([...orderIdsIn(run.spans)]).toEqual([`C-${i}`]);
      });
    }
  });
});
