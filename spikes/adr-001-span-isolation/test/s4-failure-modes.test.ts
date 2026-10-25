import { describe, expect, it } from 'vitest';
import { context, ROOT_CONTEXT } from '@opentelemetry/api';
import { createCollector, NoSpansCollectedError } from '../src/collector';
import { runSupportAgent } from '../src/agent';

const collector = await createCollector();

describe('S4 failure modes', () => {
  it('telemetry disabled per call → loud NoSpansCollectedError', async () => {
    await expect(
      collector.run('disabled', () => runSupportAgent({ orderId: 'D-1', telemetry: { isEnabled: false } })),
    ).rejects.toBeInstanceOf(NoSpansCollectedError);
  });

  it('per-call integrations override global ones → loud error', async () => {
    await expect(
      collector.run('override', () => runSupportAgent({ orderId: 'O-1', telemetry: { integrations: [] } })),
    ).rejects.toThrow(/no gen_ai spans/);
  });

  it('lost async context → loud error that names orphan spans', async () => {
    const err = await collector
      .run('lost-context', () => context.with(ROOT_CONTEXT, () => runSupportAgent({ orderId: 'L-1' })))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NoSpansCollectedError);
    expect((err as Error).message).toMatch(/outside any run/);
  });

  it('recordInputs/recordOutputs=false → spans exist but tool args/results are missing', async () => {
    const run = await collector.run('no-content', () =>
      runSupportAgent({ orderId: 'N-1', telemetry: { recordInputs: false, recordOutputs: false } }),
    );
    const tool = run.spans.find((s) => s.attributes['gen_ai.operation.name'] === 'execute_tool')!;
    expect(tool.attributes['gen_ai.tool.name']).toBe('lookup_order');
    expect(tool.attributes['gen_ai.tool.call.arguments']).toBeUndefined();
    expect(tool.attributes['gen_ai.tool.call.result']).toBeUndefined();
  });
});
