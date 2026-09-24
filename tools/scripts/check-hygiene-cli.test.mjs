import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// CLI (main()) coverage: check-hygiene.mjs derives its repo root from its own script path, so the
// script is copied into a throwaway git repo under tools/scripts/ and run with `node`, exactly as
// husky/CI invoke it.
const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('check-hygiene CLI', () => {
  let repo;
  let script;

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'hygiene-cli-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    mkdirSync(path.join(repo, 'tools', 'scripts'), { recursive: true });
    script = path.join(repo, 'tools', 'scripts', 'check-hygiene.mjs');
    cpSync(path.join(HERE, 'check-hygiene.mjs'), script);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('exits 1 on a tracked forbidden document and 0 once it is untracked', () => {
    writeFileSync(path.join(repo, 'x.pdf'), 'not a real pdf');
    execFileSync('git', ['add', 'x.pdf'], { cwd: repo });

    const failing = spawnSync('node', [script], { cwd: repo, encoding: 'utf8' });
    expect(failing.status).toBe(1);
    expect(failing.stderr).toContain('hygiene: client-type document outside docs/client/: x.pdf');

    execFileSync('git', ['rm', '-q', '--cached', 'x.pdf'], { cwd: repo });

    const passing = spawnSync('node', [script], { cwd: repo, encoding: 'utf8' });
    expect(passing.status).toBe(0);
    expect(passing.stdout).toContain('hygiene: ok');
  });

  it('exits 1 on two store directories of a single-copy package and 0 with one', () => {
    const store = path.join(repo, 'node_modules', '.pnpm');
    mkdirSync(path.join(store, '@prisma+client@7.10.0_a'), { recursive: true });
    mkdirSync(path.join(store, '@prisma+client@7.10.0_b'), { recursive: true });

    const failing = spawnSync('node', [script], { cwd: repo, encoding: 'utf8' });
    expect(failing.status).toBe(1);
    expect(failing.stderr).toContain(
      'hygiene: @prisma/client is installed 2 times (@prisma+client@7.10.0_a, @prisma+client@7.10.0_b)',
    );

    rmSync(path.join(store, '@prisma+client@7.10.0_b'), { recursive: true });

    const passing = spawnSync('node', [script], { cwd: repo, encoding: 'utf8' });
    expect(passing.status).toBe(0);
    expect(passing.stdout).toBe('hygiene: ok (0 tracked files, single copies ok)\n');
  });
});
