import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import ts from 'typescript';

const presets = path.join(import.meta.dirname, '..', 'tsconfig');
const scratch = mkdtempSync(path.join(tmpdir(), 'tms-config-tsconfig-'));
// The throwaway packages live outside the repository, so they borrow this package's @types/node
// (a real package finds its own through node_modules).
const typeRoots = [path.join(import.meta.dirname, '..', 'node_modules', '@types')];

const USES_PROCESS = `export const nodeEnv: string | undefined = process.env['NODE_ENV'];\n`;
const DECORATED = `function Injectable(): ClassDecorator {
  return () => undefined;
}

export class Clock {
  now(): Date {
    return new Date(0);
  }
}

@Injectable()
export class Greeter {
  constructor(private readonly clock: Clock) {}

  greet(): string {
    return \`pid \${process.pid} at \${this.clock.now().toISOString()}\`;
  }
}
`;

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * Parses a throwaway package tsconfig that extends one preset, the way `tsc -p` does.
 *
 * @param {string} preset file name under packages/config/tsconfig
 * @param {{ source?: string, type?: 'module' | 'commonjs', compilerOptions?: object }} [options]
 *   `type` writes a package.json, which decides the module format under `nodenext`.
 */
function parseExtending(preset, { source = 'export const x = 1;\n', type, compilerOptions } = {}) {
  const pkg = mkdtempSync(path.join(scratch, 'pkg-'));
  mkdirSync(path.join(pkg, 'src'));
  writeFileSync(path.join(pkg, 'src', 'index.ts'), source);
  if (type) writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ type }));
  const configPath = path.join(pkg, 'tsconfig.json');
  writeFileSync(
    configPath,
    JSON.stringify({ extends: path.join(presets, preset), compilerOptions, include: ['src'] }),
  );
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  return { pkg, parsed: ts.parseJsonConfigFileContent(config, ts.sys, pkg, undefined, configPath) };
}

/**
 * Type-checks a throwaway package like `tsc --noEmit -p` would.
 *
 * @returns {string[]} the distinct TS error codes, sorted
 */
function typecheck(preset, { source, type }) {
  const { parsed } = parseExtending(preset, {
    source,
    type,
    compilerOptions: { noEmit: true, typeRoots },
  });
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  return [...new Set(diagnostics.map((d) => `TS${d.code}`))].sort();
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

  it.each(['node-library.json', 'nest-library.json'])(
    '%s resolves outDir and rootDir inside the extending package (${configDir})',
    (preset) => {
      const { pkg, parsed } = parseExtending(preset);
      expect(parsed.errors).toEqual([]);
      expect(parsed.options.outDir).toBe(path.join(pkg, 'dist'));
      expect(parsed.options.rootDir).toBe(path.join(pkg, 'src'));
    },
  );

  it('node-library.json is library.json plus the Node types', () => {
    const { parsed } = parseExtending('node-library.json');
    expect(parsed.options.types).toEqual(['node']);
    expect(parsed.options.verbatimModuleSyntax).toBe(true);
    expect(parsed.options.declaration).toBe(true);
  });

  it('nest-library.json has decorators, declarations and Node types but no verbatimModuleSyntax', () => {
    const { parsed } = parseExtending('nest-library.json');
    expect(parsed.options).toMatchObject({
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      declaration: true,
      declarationMap: true,
      types: ['node'],
    });
    expect(parsed.options.verbatimModuleSyntax).toBeUndefined();
  });

  it('library.json has no Node types: process is unknown (TS2591)', () => {
    expect(typecheck('library.json', { source: USES_PROCESS, type: 'module' })).toEqual(['TS2591']);
  });

  it('node-library.json type-checks the same file cleanly', () => {
    expect(typecheck('node-library.json', { source: USES_PROCESS, type: 'module' })).toEqual([]);
  });

  it('nest-library.json type-checks a decorated class in a CommonJS package', () => {
    expect(typecheck('nest-library.json', { source: DECORATED, type: 'commonjs' })).toEqual([]);
  });

  it('library.json rejects that CommonJS file (verbatimModuleSyntax), so nest-library.json must not extend it', () => {
    expect(typecheck('library.json', { source: DECORATED, type: 'commonjs' })).toEqual([
      'TS1287',
      'TS2591',
    ]);
  });
});
