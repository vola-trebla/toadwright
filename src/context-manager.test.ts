import { setTimeout as sleep } from 'node:timers/promises';
import { type Context, context, createContextKey, ROOT_CONTEXT } from '@opentelemetry/api';
import { afterEach, describe, expect, it } from 'vitest';
import { AsyncLocalStorageContextManager } from './context-manager.js';

const KEY = createContextKey('test.key');
const ctxWith = (value: string): Context => ROOT_CONTEXT.setValue(KEY, value);
const valueIn = (manager: AsyncLocalStorageContextManager) => manager.active().getValue(KEY);

describe('AsyncLocalStorageContextManager', () => {
  it('returns ROOT_CONTEXT when nothing is active', () => {
    expect(new AsyncLocalStorageContextManager().enable().active()).toBe(ROOT_CONTEXT);
  });

  it('keeps the context across await, timers and promise callbacks', async () => {
    const manager = new AsyncLocalStorageContextManager().enable();
    const seen = await manager.with(ctxWith('a'), async () => {
      const values: unknown[] = [valueIn(manager)];
      await sleep(1);
      values.push(valueIn(manager));
      await new Promise<void>((resolve) =>
        setTimeout(() => {
          values.push(valueIn(manager));
          resolve();
        }, 1),
      );
      values.push(await Promise.resolve().then(() => valueIn(manager)));
      return values;
    });
    expect(seen).toEqual(['a', 'a', 'a', 'a']);
    expect(manager.active()).toBe(ROOT_CONTEXT);
  });

  it('isolates concurrent with() calls', async () => {
    const manager = new AsyncLocalStorageContextManager().enable();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        manager.with(ctxWith(`run-${i}`), async () => {
          await sleep(Math.random() * 5);
          return valueIn(manager);
        }),
      ),
    );
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => `run-${i}`));
  });

  it('restores the outer context after a nested with()', () => {
    const manager = new AsyncLocalStorageContextManager().enable();
    manager.with(ctxWith('outer'), () => {
      manager.with(ctxWith('inner'), () => expect(valueIn(manager)).toBe('inner'));
      expect(valueIn(manager)).toBe('outer');
    });
  });

  it('passes thisArg and arguments through with()', () => {
    const manager = new AsyncLocalStorageContextManager().enable();
    const target = { factor: 3 };
    const result = manager.with(
      ROOT_CONTEXT,
      function (this: typeof target, a: number, b: number) {
        return (a + b) * this.factor;
      },
      target,
      1,
      2,
    );
    expect(result).toBe(9);
  });

  it('bind() fixes the context of a function and keeps its arity', () => {
    const manager = new AsyncLocalStorageContextManager().enable();
    const bound = manager.bind(ctxWith('bound'), (_a: number, _b: number) => valueIn(manager));
    expect(bound.length).toBe(2);
    expect(manager.with(ctxWith('caller'), () => bound(1, 2))).toBe('bound');
  });

  it('bind() returns non-function targets unchanged', () => {
    const manager = new AsyncLocalStorageContextManager().enable();
    const target = { not: 'a function' };
    expect(manager.bind(ctxWith('x'), target)).toBe(target);
  });

  describe('disable()', () => {
    it('makes in-flight async operations see ROOT_CONTEXT', async () => {
      const manager = new AsyncLocalStorageContextManager().enable();
      const inFlight = manager.with(ctxWith('in-flight'), async () => {
        const before = valueIn(manager);
        await sleep(5);
        return { before, after: manager.active() };
      });
      await sleep(1);
      manager.disable();
      const { before, after } = await inFlight;
      expect(before).toBe('in-flight');
      expect(after).toBe(ROOT_CONTEXT);
    });

    it('lets a later with() work again', () => {
      const manager = new AsyncLocalStorageContextManager().enable();
      manager.disable();
      expect(manager.active()).toBe(ROOT_CONTEXT);
      expect(manager.with(ctxWith('again'), () => valueIn(manager))).toBe('again');
    });
  });

  describe('as the global context manager', () => {
    afterEach(() => context.disable());

    it('registers and propagates through the API', async () => {
      expect(context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())).toBe(true);
      const value = await context.with(ctxWith('global'), async () => {
        await sleep(1);
        return context.active().getValue(KEY);
      });
      expect(value).toBe('global');
    });
  });
});
