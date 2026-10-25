/** Helpers that turn a flat list of spans into comparable shapes. Shared by the scenario tests. */
import type { HrTime, SpanContext } from '@opentelemetry/api';

/** The subset of a span both toadwright's `RecordedSpan` and the SDK's `ReadableSpan` provide. */
export interface SpanLike {
  readonly name: string;
  readonly parentSpanContext?: SpanContext | undefined;
  readonly startTime: HrTime;
  spanContext(): SpanContext;
}

/**
 * The span tree as indented names, children in start order. A span whose parent is not in the
 * list counts as a root.
 */
export function describeTree(spans: readonly SpanLike[]): string[] {
  const ids = new Set(spans.map((s) => s.spanContext().spanId));
  const byParent = new Map<string, SpanLike[]>();
  for (const span of spans) {
    const parentId = span.parentSpanContext?.spanId;
    const key = parentId !== undefined && ids.has(parentId) ? parentId : 'root';
    byParent.set(key, [...(byParent.get(key) ?? []), span]);
  }
  const lines: string[] = [];
  const walk = (parentId: string, depth: number) => {
    const children = [...(byParent.get(parentId) ?? [])].sort(
      (a, b) => a.startTime[0] - b.startTime[0] || a.startTime[1] - b.startTime[1],
    );
    for (const child of children) {
      lines.push(`${'  '.repeat(depth)}${child.name}`);
      walk(child.spanContext().spanId, depth + 1);
    }
  };
  walk('root', 0);
  return lines;
}
