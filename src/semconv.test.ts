import { describe, expect, it } from 'vitest';
import { runSupportAgent } from './__fixtures__/support-agent.js';
import { getCollector } from './collector.js';
import { ATTR, OPERATION, SEMCONV_VERSION } from './semconv.js';

/** Which mapped attributes AI SDK 7 must emit on which operation (ADR-006). */
const EXPECTED: Record<string, readonly string[]> = {
  [OPERATION.invokeAgent]: [
    ATTR.operationName,
    ATTR.agentName,
    ATTR.requestModel,
    ATTR.responseFinishReasons,
    ATTR.usageInputTokens,
    ATTR.usageOutputTokens,
    ATTR.usageCacheReadInputTokens,
    ATTR.usageCacheCreationInputTokens,
  ],
  [OPERATION.agentStep]: [ATTR.operationName],
  [OPERATION.chat]: [
    ATTR.operationName,
    ATTR.providerName,
    ATTR.requestModel,
    ATTR.responseModel,
    ATTR.responseFinishReasons,
    ATTR.usageInputTokens,
    ATTR.usageOutputTokens,
    ATTR.usageCacheReadInputTokens,
    ATTR.usageCacheCreationInputTokens,
  ],
  [OPERATION.executeTool]: [
    ATTR.operationName,
    ATTR.toolName,
    ATTR.toolCallId,
    ATTR.toolCallArguments,
    ATTR.toolCallResult,
  ],
};

describe('semconv mapping', () => {
  it('pins semantic conventions v1.41.0', () => {
    expect(SEMCONV_VERSION).toBe('1.41.0');
  });

  it('every mapped attribute is emitted by AI SDK on the span type it is mapped for', async () => {
    const { spans } = await getCollector().run('semconv', () => runSupportAgent({ orderId: 'S-1' }));
    const operations = new Set(spans.map((s) => s.attributes[ATTR.operationName]));
    expect([...operations].sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const span of spans) {
      const expected = EXPECTED[String(span.attributes[ATTR.operationName])] ?? [];
      for (const key of expected) expect(span.attributes, `${span.name} has ${key}`).toHaveProperty([key]);
    }
  });

  it('every mapped attribute is covered by the check above, except error.type', () => {
    const covered = new Set(Object.values(EXPECTED).flat());
    // AI SDK marks failures with status ERROR and an exception event, not error.type (ADR-006).
    expect(Object.values(ATTR).filter((key) => !covered.has(key))).toEqual([ATTR.errorType]);
  });
});
