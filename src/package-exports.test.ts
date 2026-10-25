import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface ExportTarget {
  types: string;
  default: string;
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  exports: Record<string, ExportTarget | string>;
};

const entries = Object.entries(pkg.exports).filter((e): e is [string, ExportTarget] => typeof e[1] !== 'string');

/** Maps a published dist path to the source file it is compiled from. */
const toSource = (distPath: string) => distPath.replace(/^\.\/dist\//, './').replace(/\.(d\.ts|js)$/, '.ts');

describe('package exports', () => {
  it('declares the root and vitest entry points', () => {
    expect(entries.map(([key]) => key)).toEqual(['.', './vitest']);
  });

  it.each(entries)('%s maps to an existing source module', async (_key, target) => {
    const source = toSource(target.default);
    expect(toSource(target.types)).toBe(source);
    const url = new URL(source, new URL('./', import.meta.url));
    expect(existsSync(url)).toBe(true);
    await expect(import(url.href)).resolves.toBeDefined();
  });
});
