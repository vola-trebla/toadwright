/**
 * The only place that spells OpenTelemetry GenAI names (ADR-006). The conventions are still
 * Development: a rename upstream is a change here, caught by `semconv.test.ts`.
 */

/** Semantic conventions release these names follow: the last core release with GenAI in it. */
export const SEMCONV_VERSION = '1.41.0';

/** Values of `gen_ai.operation.name` that toadwright reads. */
export const OPERATION = {
  invokeAgent: 'invoke_agent',
  chat: 'chat',
  executeTool: 'execute_tool',
  /** AI SDK extension, not a semconv operation: the `step N` span between agent and model calls. */
  agentStep: 'agent_step',
} as const;

/** Span attribute keys that toadwright reads. */
export const ATTR = {
  operationName: 'gen_ai.operation.name',
  agentName: 'gen_ai.agent.name',
  providerName: 'gen_ai.provider.name',
  requestModel: 'gen_ai.request.model',
  responseModel: 'gen_ai.response.model',
  responseFinishReasons: 'gen_ai.response.finish_reasons',
  usageInputTokens: 'gen_ai.usage.input_tokens',
  usageOutputTokens: 'gen_ai.usage.output_tokens',
  usageCacheReadInputTokens: 'gen_ai.usage.cache_read.input_tokens',
  usageCacheCreationInputTokens: 'gen_ai.usage.cache_creation.input_tokens',
  toolName: 'gen_ai.tool.name',
  toolCallId: 'gen_ai.tool.call.id',
  /** Opt-in content: absent when the instrumentation does not record inputs. */
  toolCallArguments: 'gen_ai.tool.call.arguments',
  /** Opt-in content: absent when the instrumentation does not record outputs. */
  toolCallResult: 'gen_ai.tool.call.result',
  /** General semconv attribute. AI SDK does not set it; it marks errors with status and an exception event. */
  errorType: 'error.type',
} as const;
