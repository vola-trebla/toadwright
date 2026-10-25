import { type ContextManager, context, ROOT_CONTEXT } from '@opentelemetry/api';
import { expect, it } from 'vitest';
import { ContextManagerError, getCollector } from './collector.js';

/** A registered manager that ignores with(): context never propagates. */
const brokenManager: ContextManager = {
  active: () => ROOT_CONTEXT,
  with: (_ctx, fn, thisArg, ...args) => fn.call(thisArg, ...args),
  bind: (_ctx, target) => target,
  enable() {
    return this;
  },
  disable() {
    return this;
  },
};

it('fails loudly when a non-propagating context manager is registered', async () => {
  context.setGlobalContextManager(brokenManager);
  await expect(getCollector().run('broken manager', () => 'never runs')).rejects.toThrow(ContextManagerError);
});
