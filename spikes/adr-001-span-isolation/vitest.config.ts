import { defineConfig } from 'vitest/config';
// Each scenario file runs in its own isolated worker, so global OTel /
// AI SDK registrations from one scenario never leak into another.
export default defineConfig({ test: { pool: 'forks', isolate: true, include: ['test/**/*.test.ts'] } });
