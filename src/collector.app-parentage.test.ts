import { OpenTelemetry } from '@ai-sdk/otel';
import { trace } from '@opentelemetry/api';
import { generateText, isStepCount, jsonSchema, registerTelemetry, tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { expect, it } from 'vitest';
import { getCollector } from './collector.js';
import { RecordingTracer } from './recording-tracer.js';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

// The risky order: toadwright registers before the app (app telemetry initialised lazily).
const collector = getCollector();
registerTelemetry(new OpenTelemetry({ tracer: new RecordingTracer() }));

it("keeps the app's span active inside tools and provider calls when toadwright registered first", async () => {
  const activeInside: string[] = [];
  const activeSpanId = () => trace.getActiveSpan()?.spanContext().spanId ?? 'none';
  let call = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      activeInside.push(activeSpanId());
      call += 1;
      return call === 1
        ? {
            content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'lookup', input: '{}' }],
            finishReason: { unified: 'tool-calls', raw: undefined },
            usage,
            warnings: [],
          }
        : {
            content: [{ type: 'text', text: 'ok' }],
            finishReason: { unified: 'stop', raw: undefined },
            usage,
            warnings: [],
          };
    },
  });
  const lookup = tool({
    inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
    execute: async () => {
      activeInside.push(activeSpanId());
      return 'found';
    },
  });

  const { spans } = await collector.run('app parentage', () =>
    generateText({ model, tools: { lookup }, stopWhen: isStepCount(3), prompt: 'go' }),
  );

  // Two model calls and one tool call, each with the app's span active, never a toadwright one.
  const toadwrightIds = new Set(spans.map((s) => s.spanContext().spanId));
  expect(activeInside).toHaveLength(3);
  expect(activeInside).not.toContain('none');
  for (const id of activeInside) expect(toadwrightIds.has(id)).toBe(false);
});
