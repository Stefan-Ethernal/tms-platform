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

  /** Writes node_modules/.pnpm/lock.yaml (what pnpm materialized) with these snapshot keys. */
  function writeInstalledLockfile(keys) {
    const store = path.join(repo, 'node_modules', '.pnpm');
    mkdirSync(store, { recursive: true });
    const snapshots = keys.map((key) => `  '${key}': {}\n`).join('\n');
    writeFileSync(
      path.join(store, 'lock.yaml'),
      `lockfileVersion: '9.0'\n\nsnapshots:\n\n${snapshots}`,
    );
    return store;
  }

  it('exits 1 on two installed peer variants of a single-copy package and 0 with one', () => {
    writeInstalledLockfile([
      '@prisma/client@7.10.0(pg@8.23.0)',
      '@prisma/client@7.10.0(pg@8.24.0)',
    ]);

    const failing = spawnSync('node', [script], { cwd: repo, encoding: 'utf8' });
    expect(failing.status).toBe(1);
    expect(failing.stderr).toContain(
      'hygiene: @prisma/client is installed 2 times (@prisma/client@7.10.0(pg@8.23.0), @prisma/client@7.10.0(pg@8.24.0))',
    );

    writeInstalledLockfile(['@prisma/client@7.10.0(pg@8.24.0)']);

    const passing = spawnSync('node', [script], { cwd: repo, encoding: 'utf8' });
    expect(passing.status).toBe(0);
    expect(passing.stdout).toBe('hygiene: ok (0 tracked files, single copies ok)\n');
  });

  it('ignores an orphaned store directory that the installed lockfile no longer lists', () => {
    // pnpm leaves the old virtual-store directory behind after a version bump.
    const store = writeInstalledLockfile(['@prisma/client@7.10.0(pg@8.24.0)']);
    mkdirSync(path.join(store, '@prisma+client@7.9.0_pg@8.24.0'));
    mkdirSync(path.join(store, '@prisma+client@7.10.0_pg@8.24.0'));

    const result = spawnSync('node', [script], { cwd: repo, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('hygiene: ok (0 tracked files, single copies ok)\n');
  });

  it('skips the single-copy check when node_modules/.pnpm has no lock.yaml', () => {
    mkdirSync(path.join(repo, 'node_modules', '.pnpm', '@prisma+client@7.10.0_a'), {
      recursive: true,
    });

    const result = spawnSync('node', [script], { cwd: repo, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('hygiene: ok (0 tracked files, single-copy check skipped)\n');
  });
});
