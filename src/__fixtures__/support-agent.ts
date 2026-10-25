/**
 * A tiny "support agent" driven by a scripted mock model, shared by the ADR-001 scenario tests.
 * Each run gets its own order id, so a span that leaks into another run is detectable.
 */
import { generateText, isStepCount, jsonSchema, streamText, type Telemetry, tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

/** Per model call. Cache tokens are part of the input total, as providers report them. */
const usage = {
  inputTokens: { total: 10, noCache: 6, cacheRead: 3, cacheWrite: 1 },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

const sleep = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

const toolCall = (id: string, toolName: string, input: unknown) => ({
  content: [{ type: 'tool-call' as const, toolCallId: id, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: 'tool-calls' as const, raw: undefined },
  usage,
  warnings: [],
});

/** lookup_order, then issue_refund, then a final answer: three steps. */
function scriptedModel(orderId: string, jitterMs: number) {
  let call = 0;
  return new MockLanguageModelV4({
    provider: 'mock',
    modelId: 'mock-support-1',
    doGenerate: async () => {
      await sleep(Math.random() * jitterMs);
      call += 1;
      if (call === 1) return toolCall(`c1-${orderId}`, 'lookup_order', { orderId });
      if (call === 2) return toolCall(`c2-${orderId}`, 'issue_refund', { orderId, amount: 42 });
      return {
        content: [{ type: 'text' as const, text: `Refund for ${orderId} issued.` }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
}

type ToolHook = (toolName: string) => void;

function tools(jitterMs: number, onToolExecute: ToolHook) {
  return {
    lookup_order: tool({
      inputSchema: jsonSchema<{ orderId: string }>({
        type: 'object',
        properties: { orderId: { type: 'string' } },
        required: ['orderId'],
      }),
      execute: async ({ orderId }) => {
        await sleep(Math.random() * jitterMs);
        onToolExecute('lookup_order');
        return { orderId, total: 42 };
      },
    }),
    issue_refund: tool({
      inputSchema: jsonSchema<{ orderId: string; amount: number }>({
        type: 'object',
        properties: { orderId: { type: 'string' }, amount: { type: 'number' } },
        required: ['orderId', 'amount'],
      }),
      execute: async ({ orderId, amount }) => {
        await sleep(Math.random() * jitterMs);
        onToolExecute('issue_refund');
        return { orderId, refunded: amount };
      },
    }),
  };
}

export interface SupportAgentOptions {
  readonly orderId: string;
  /** Random delay (ms) before each model and tool call, so parallel runs interleave. */
  readonly jitterMs?: number;
  /** Runs inside each tool's execute, e.g. to create the app's own DB span there. */
  readonly onToolExecute?: ToolHook;
  readonly telemetry?: {
    readonly isEnabled?: boolean;
    readonly recordInputs?: boolean;
    readonly recordOutputs?: boolean;
    readonly integrations?: Telemetry[];
  };
}

export async function runSupportAgent({
  orderId,
  jitterMs = 0,
  onToolExecute = () => {},
  telemetry,
}: SupportAgentOptions): Promise<string> {
  const res = await generateText({
    model: scriptedModel(orderId, jitterMs),
    tools: tools(jitterMs, onToolExecute),
    stopWhen: isStepCount(5),
    prompt: `Refund order ${orderId}`,
    telemetry: { functionId: 'support-agent', ...telemetry },
  });
  return res.text;
}

export async function runStreamingAgent(orderId: string): Promise<string> {
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
  const result = streamText({ model, prompt: `stream ${orderId}`, telemetry: { functionId: 'stream-agent' } });
  let out = '';
  for await (const delta of result.textStream) out += delta;
  return out;
}

/** The gen_ai tree the support agent must produce, with or without app telemetry. */
export const SUPPORT_AGENT_TREE = [
  'invoke_agent mock-support-1',
  '  step 1',
  '    chat mock-support-1',
  '    execute_tool lookup_order',
  '  step 2',
  '    chat mock-support-1',
  '    execute_tool issue_refund',
  '  step 3',
  '    chat mock-support-1',
];
