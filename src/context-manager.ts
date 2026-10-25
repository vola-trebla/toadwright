/**
 * In-house AsyncLocalStorage context manager (ADR-001, follow-up for M1).
 *
 * Replaces `@opentelemetry/context-async-hooks`, whose peer range caps the API below 1.11, so that
 * toadwright depends on nothing but `@opentelemetry/api`. Semantics mirror that package's
 * `AsyncLocalStorageContextManager`, minus EventEmitter patching and the optional `attach()`:
 * toadwright only needs `with()` propagation through async code.
 *
 * It is installed globally only when no working context manager exists (ADR-001, decision 4).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { type Context, type ContextManager, ROOT_CONTEXT } from '@opentelemetry/api';

export class AsyncLocalStorageContextManager implements ContextManager {
  private readonly storage = new AsyncLocalStorage<Context>();
  /**
   * Set by disable(), cleared by the next with(). Node 24's AsyncContextFrame keeps the store of
   * in-flight operations after AsyncLocalStorage.disable(), contrary to its docs; Node 22 clears it.
   * The flag gives the documented behavior on every runtime.
   */
  private disabled = false;

  active(): Context {
    if (this.disabled) return ROOT_CONTEXT;
    return this.storage.getStore() ?? ROOT_CONTEXT;
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    context: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    this.disabled = false;
    const callback = thisArg == null ? fn : fn.bind(thisArg);
    return this.storage.run(context, callback, ...args);
  }

  /** Binds functions to `context`. Any other target (e.g. an EventEmitter) is returned unchanged. */
  bind<T>(context: Context, target: T): T {
    if (typeof target !== 'function') return target;
    const manager = this;
    // `typeof` narrowed `target` to a function; its exact signature does not matter here.
    const original = target as unknown as (...args: unknown[]) => unknown;
    const bound = function (this: unknown, ...args: unknown[]) {
      return manager.with(context, () => original.apply(this, args));
    };
    Object.defineProperty(bound, 'length', { value: original.length, configurable: true });
    return bound as T;
  }

  enable(): this {
    return this;
  }

  /**
   * Disables the manager: every async operation, including ones already in flight, sees
   * `ROOT_CONTEXT` until the next `with()` call — on Node 22 and 24 alike.
   */
  disable(): this {
    this.disabled = true;
    this.storage.disable();
    return this;
  }
}
