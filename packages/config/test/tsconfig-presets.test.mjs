import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import ts from 'typescript';

const presets = path.join(import.meta.dirname, '..', 'tsconfig');
const scratch = mkdtempSync(path.join(tmpdir(), 'tms-config-tsconfig-'));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * Parses a throwaway package tsconfig that extends one preset, the way `tsc -p` does.
 *
 * @param {string} preset file name under packages/config/tsconfig
 */
function parseExtending(preset) {
  const pkg = mkdtempSync(path.join(scratch, 'pkg-'));
  mkdirSync(path.join(pkg, 'src'));
  writeFileSync(path.join(pkg, 'src', 'index.ts'), 'export const x = 1;\n');
  const configPath = path.join(pkg, 'tsconfig.json');
  writeFileSync(
    configPath,
    JSON.stringify({ extends: path.join(presets, preset), include: ['src'] }),
  );
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  return { pkg, parsed: ts.parseJsonConfigFileContent(config, ts.sys, pkg, undefined, configPath) };
}

describe('tsconfig presets', () => {
  it('library.json resolves outDir and rootDir inside the extending package', () => {
    const { pkg, parsed } = parseExtending('library.json');
    expect(parsed.errors).toEqual([]);
    expect(parsed.options.outDir).toBe(path.join(pkg, 'dist'));
    expect(parsed.options.rootDir).toBe(path.join(pkg, 'src'));
  });

  it('nest.json leaves incrementality to turbo, so typecheck writes no tsbuildinfo into dist', () => {
    const { parsed } = parseExtending('nest.json');
    expect(parsed.options.incremental).toBeUndefined();
    expect(parsed.options.composite).toBeUndefined();
  });
});
