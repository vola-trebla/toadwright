/**
 * A tiny "support agent" driven by a scripted mock model.
 * Each run gets its own order id so cross-test leakage is detectable.
 */
import { generateText, isStepCount, streamText, tool, type Telemetry } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function scriptedModel(orderId: string, jitterMs: number) {
  let call = 0;
  return new MockLanguageModelV4({
    provider: 'mock',
    modelId: 'mock-support-1',
    doGenerate: async () => {
      await sleep(Math.random() * jitterMs);
      call += 1;
      if (call === 1) {
        return {
          content: [{ type: 'tool-call', toolCallId: `c1-${orderId}`, toolName: 'lookup_order', input: JSON.stringify({ orderId }) }],
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage,
          warnings: [],
        };
      }
      if (call === 2) {
        return {
          content: [{ type: 'tool-call', toolCallId: `c2-${orderId}`, toolName: 'issue_refund', input: JSON.stringify({ orderId, amount: 42 }) }],
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage,
          warnings: [],
        };
      }
      return {
        content: [{ type: 'text', text: `Refund for ${orderId} issued.` }],
        finishReason: { unified: 'stop', raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
}

function tools(jitterMs: number) {
  return {
    lookup_order: tool({
      inputSchema: z.object({ orderId: z.string() }),
      execute: async ({ orderId }) => {
        await sleep(Math.random() * jitterMs);
        return { orderId, total: 42 };
      },
    }),
    issue_refund: tool({
      inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
      execute: async ({ orderId, amount }) => {
        await sleep(Math.random() * jitterMs);
        return { orderId, refunded: amount };
      },
    }),
  };
}

export interface RunOptions {
  orderId: string;
  jitterMs?: number;
  telemetry?: { isEnabled?: boolean; recordInputs?: boolean; recordOutputs?: boolean; integrations?: Telemetry[] };
}

export async function runSupportAgent({ orderId, jitterMs = 0, telemetry }: RunOptions) {
  const res = await generateText({
    model: scriptedModel(orderId, jitterMs),
    tools: tools(jitterMs),
    stopWhen: isStepCount(5),
    prompt: `Refund order ${orderId}`,
    telemetry: { functionId: 'support-agent', ...telemetry },
  });
  return res.text;
}

export async function runStreamingAgent(orderId: string) {
  const model = new MockLanguageModelV4({
    provider: 'mock',
    modelId: 'mock-stream-1',
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: 'stream-start', warnings: [] });
          c.enqueue({ type: 'text-start', id: 't1' });
          c.enqueue({ type: 'text-delta', id: 't1', delta: `streamed ${orderId}` });
          c.enqueue({ type: 'text-end', id: 't1' });
          c.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage });
          c.close();
        },
      }),
    }),
  });
  const r = streamText({ model, prompt: `stream ${orderId}`, telemetry: { functionId: 'stream-agent' } });
  let out = '';
  for await (const d of r.textStream) out += d;
  return out;
}
