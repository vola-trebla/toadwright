import { context, DiagLogLevel, diag, ROOT_CONTEXT } from '@opentelemetry/api';
import { generateText, isStepCount, jsonSchema, streamText, tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { ensureContextManager, getCollector, NoSpansCollectedError, OpenSpansError } from './collector.js';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Scripted support agent: lookup_order, then a final answer. Jitter interleaves parallel runs. */
async function runAgent(orderId: string, telemetry: { isEnabled?: boolean } = {}) {
  let call = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      await sleep(Math.random() * 10);
      call += 1;
      return call === 1
        ? {
            content: [
              {
                type: 'tool-call',
                toolCallId: `c-${orderId}`,
                toolName: 'lookup_order',
                input: `{"orderId":"${orderId}"}`,
              },
            ],
            finishReason: { unified: 'tool-calls', raw: undefined },
            usage,
            warnings: [],
          }
        : {
            content: [{ type: 'text', text: `Order ${orderId} found.` }],
            finishReason: { unified: 'stop', raw: undefined },
            usage,
            warnings: [],
          };
    },
  });
  const lookupOrder = tool({
    inputSchema: jsonSchema<{ orderId: string }>({ type: 'object', properties: { orderId: { type: 'string' } } }),
    execute: async ({ orderId: id }) => {
      await sleep(Math.random() * 10);
      return { orderId: id, total: 42 };
    },
  });
  const res = await generateText({
    model,
    tools: { lookup_order: lookupOrder },
    stopWhen: isStepCount(5),
    prompt: `Find order ${orderId}`,
    telemetry,
  });
  return res.text;
}

const operations = (spans: readonly { attributes: Readonly<Record<string, unknown>> }[]) =>
  spans.map((s) => s.attributes['gen_ai.operation.name']).filter((op) => op !== undefined);

describe('collector', () => {
  it("returns the result and the run's gen_ai spans", async () => {
    const { result, spans } = await getCollector().run('single run', () => runAgent('A-1'));
    expect(result).toBe('Order A-1 found.');
    expect(operations(spans)).toEqual(expect.arrayContaining(['invoke_agent', 'chat', 'execute_tool']));
  });

  it('keeps parallel runs apart', async () => {
    const ids = ['P-1', 'P-2', 'P-3', 'P-4', 'P-5'];
    const runs = await Promise.all(ids.map((id) => getCollector().run(`run ${id}`, () => runAgent(id))));
    runs.forEach(({ spans }, i) => {
      const toolArgs = spans.map((s) => s.attributes['gen_ai.tool.call.arguments']).filter((a) => a !== undefined);
      expect(toolArgs).toEqual([`{"orderId":"${ids[i]}"}`]);
      expect(new Set(spans.map((s) => s.runId)).size).toBe(1);
    });
  });

  it('installs its context manager only when none works', async () => {
    await getCollector().run('install', () => runAgent('C-1'));
    expect(getCollector().installedContextManager).toBe(true);
    expect(ensureContextManager()).toBe(false);
  });

  it('does not touch a working context manager (no duplicate-registration diag error)', async () => {
    await getCollector().run('warm up', () => runAgent('C-2'));
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), verbose: vi.fn() };
    diag.setLogger(logger, DiagLogLevel.ALL);
    try {
      expect(ensureContextManager()).toBe(false);
      expect(logger.error).not.toHaveBeenCalled();
    } finally {
      diag.disable();
    }
  });

  it('is one instance per process and registers its integration once', () => {
    const integrations = () =>
      (globalThis as { AI_SDK_TELEMETRY_INTEGRATIONS?: unknown[] }).AI_SDK_TELEMETRY_INTEGRATIONS;
    const before = integrations()?.length;
    expect(getCollector()).toBe(getCollector());
    expect(before).toBe(1);
    expect(integrations()?.length).toBe(1);
  });

  it('fails loudly when telemetry is disabled', async () => {
    const run = getCollector().run('disabled', () => runAgent('D-1', { isEnabled: false }));
    await expect(run).rejects.toThrow(NoSpansCollectedError);
    await expect(run).rejects.toThrow(/telemetry disabled/);
  });

  it('points at lost async context when gen_ai spans end outside any run', async () => {
    const run = getCollector().run('lost context', () => context.with(ROOT_CONTEXT, () => runAgent('L-1')));
    await expect(run).rejects.toThrow(/async context was probably lost/);
  });

  it('fails when spans are still open after the body returns', async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: 'stream-start', warnings: [] });
            c.enqueue({ type: 'text-start', id: 't1' });
            c.enqueue({ type: 'text-delta', id: 't1', delta: 'hi' });
            c.enqueue({ type: 'text-end', id: 't1' });
            c.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage });
            c.close();
          },
        }),
      }),
    });
    // The stream is never consumed, so the agent span never ends.
    const run = getCollector().run('unconsumed stream', () => {
      streamText({ model, prompt: 'hi' });
    });
    await expect(run).rejects.toThrow(OpenSpansError);
    await expect(run).rejects.toThrow(/did you consume the stream\?/);
  });
});
