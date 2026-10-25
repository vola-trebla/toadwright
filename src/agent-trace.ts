/**
 * `AgentTrace`: one run's gen_ai spans normalized into what trajectory assertions read.
 * Internal (ADR-004). Attribute names come from `semconv.ts` only (ADR-006).
 *
 * The flat `toolCalls` / `modelCalls` lists hold every call of the run in start order and are what
 * matchers should use. `agents` is a best-effort hierarchy on top: agent → steps → calls.
 */
import type { AttributeValue } from '@opentelemetry/api';
import type { RecordedSpan } from './recording-tracer.js';
import { ATTR, OPERATION } from './semconv.js';

/** Opt-in content (tool arguments, results): "not recorded" is not the same as "empty". */
export type Content = { readonly recorded: false } | { readonly recorded: true; readonly value: unknown };

export interface ToolCall {
  readonly name: string;
  readonly callId: string | undefined;
  /** Parsed JSON, or the raw value when it is not JSON. */
  readonly args: Content;
  /** Parsed JSON, or the raw value when it is not JSON. */
  readonly result: Content;
}

export interface ModelCall {
  readonly provider: string | undefined;
  readonly requestModel: string | undefined;
  readonly responseModel: string | undefined;
  readonly finishReasons: readonly string[];
}

export interface Step {
  /** 1-based, in start order within the agent. */
  readonly index: number;
  readonly modelCalls: readonly ModelCall[];
  readonly toolCalls: readonly ToolCall[];
}

export interface AgentInvocation {
  readonly name: string | undefined;
  readonly requestModel: string | undefined;
  readonly finishReasons: readonly string[];
  readonly steps: readonly Step[];
}

export interface AgentTrace {
  /**
   * Every `invoke_agent` span in start order. A nested agent is listed as an agent of its own: its
   * parent is the app's tool span, which toadwright does not record (ADR-001, finding 11).
   */
  readonly agents: readonly AgentInvocation[];
  readonly modelCalls: readonly ModelCall[];
  readonly toolCalls: readonly ToolCall[];
}

const stringAttr = (value: AttributeValue | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

const stringsAttr = (value: AttributeValue | undefined): readonly string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

function content(value: AttributeValue | undefined): Content {
  if (value === undefined) return { recorded: false };
  if (typeof value !== 'string') return { recorded: true, value };
  try {
    return { recorded: true, value: JSON.parse(value) };
  } catch {
    return { recorded: true, value };
  }
}

const operation = (span: RecordedSpan) => span.attributes[ATTR.operationName];

const byStart = (a: RecordedSpan, b: RecordedSpan) =>
  a.startTime[0] - b.startTime[0] || a.startTime[1] - b.startTime[1];

export function toAgentTrace(spans: readonly RecordedSpan[]): AgentTrace {
  const ordered = [...spans].sort(byStart);
  const children = new Map<string, RecordedSpan[]>();
  for (const span of ordered) {
    const parentId = span.parentSpanContext?.spanId;
    if (parentId !== undefined) children.set(parentId, [...(children.get(parentId) ?? []), span]);
  }
  const childrenOf = (span: RecordedSpan, op: string) =>
    (children.get(span.spanContext().spanId) ?? []).filter((child) => operation(child) === op);

  // One object per span, so the flat lists and the hierarchy share instances.
  const modelCalls = new Map<RecordedSpan, ModelCall>();
  const toolCalls = new Map<RecordedSpan, ToolCall>();
  for (const span of ordered) {
    const { attributes: a } = span;
    if (operation(span) === OPERATION.chat) {
      modelCalls.set(span, {
        provider: stringAttr(a[ATTR.providerName]),
        requestModel: stringAttr(a[ATTR.requestModel]),
        responseModel: stringAttr(a[ATTR.responseModel]),
        finishReasons: stringsAttr(a[ATTR.responseFinishReasons]),
      });
    } else if (operation(span) === OPERATION.executeTool) {
      toolCalls.set(span, {
        name: stringAttr(a[ATTR.toolName]) ?? span.name,
        callId: stringAttr(a[ATTR.toolCallId]),
        args: content(a[ATTR.toolCallArguments]),
        result: content(a[ATTR.toolCallResult]),
      });
    }
  }

  const agents = ordered
    .filter((span) => operation(span) === OPERATION.invokeAgent)
    .map(
      (agent): AgentInvocation => ({
        name: stringAttr(agent.attributes[ATTR.agentName]),
        requestModel: stringAttr(agent.attributes[ATTR.requestModel]),
        finishReasons: stringsAttr(agent.attributes[ATTR.responseFinishReasons]),
        steps: childrenOf(agent, OPERATION.agentStep).map((step, i) => ({
          index: i + 1,
          modelCalls: childrenOf(step, OPERATION.chat).flatMap((s) => modelCalls.get(s) ?? []),
          toolCalls: childrenOf(step, OPERATION.executeTool).flatMap((s) => toolCalls.get(s) ?? []),
        })),
      }),
    );

  return { agents, modelCalls: [...modelCalls.values()], toolCalls: [...toolCalls.values()] };
}
