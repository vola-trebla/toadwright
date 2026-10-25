import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Each test file gets its own worker: OTel and AI SDK telemetry are process-global.
    pool: 'forks',
    isolate: true,
  },
});
