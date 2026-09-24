import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorktreeFixture } from './support/worktrees.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const hooks = path.resolve(repoRoot, 'tools/claude-plugin/ethernal-nest-react/hooks');
const run = (script, input, env = {}) =>
  spawnSync('node', [path.join(hooks, script)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: input.cwd, ...env },
  });

describe('protect-files.mjs', () => {
  // For the file tools (Write, Edit, Read, NotebookEdit) Claude Code always sends an absolute
  // tool_input.file_path/notebook_path, never one relative to cwd (9-M5); build fixtures the same
  // way so a regression that only shows up on absolute paths isn't masked by the fixture shape.
  const cwd = '/work/p';
  it('exits 2 with a reason for a protected path', () => {
    const r = run('protect-files.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: path.join(cwd, '.env') },
      cwd,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('.env');
  });
  it('exits 0 for an ordinary path and 2 for a notebook under docs/client', () => {
    expect(
      run('protect-files.mjs', {
        tool_name: 'Edit',
        tool_input: { file_path: path.join(cwd, 'src/a.ts') },
        cwd,
      }).status,
    ).toBe(0);
    expect(
      run('protect-files.mjs', {
        tool_name: 'NotebookEdit',
        tool_input: { notebook_path: path.join(cwd, 'docs/client/a.ipynb') },
        cwd,
      }).status,
    ).toBe(2);
  });
  it('resolves against CLAUDE_PROJECT_DIR when the session cwd is a subdirectory', () => {
    const r = run(
      'protect-files.mjs',
      {
        tool_name: 'Edit',
        tool_input: { file_path: '/work/p/docs/client/x.pdf' },
        cwd: '/work/p/apps/api-admin',
      },
      { CLAUDE_PROJECT_DIR: '/work/p' },
    );
    expect(r.status).toBe(2);
  });
  describe('in a session started in the main checkout (9-M1)', () => {
    let fx;
    beforeAll(() => {
      fx = createWorktreeFixture();
    });
    afterAll(() => fx.remove());
    const edit = (file, env = {}) =>
      run(
        'protect-files.mjs',
        { tool_name: 'Write', tool_input: { file_path: file }, cwd: fx.main },
        env,
      );

    it.each([
      ['a sibling worktree .env', (f) => path.join(f.sibling, '.env')],
      ['sibling worktree client docs', (f) => path.join(f.sibling, 'docs/client/x.md')],
      ['client docs in a nested worktree', (f) => path.join(f.nested, 'docs/client/x.md')],
      ['an env file in a new directory', (f) => path.join(f.sibling, 'new/deeper/.env.local')],
    ])('blocks %s', (_name, file) => {
      expect(edit(file(fx)).status).toBe(2);
    });

    it('allows ordinary files in a worktree and leaves unrelated repositories alone', () => {
      expect(edit(path.join(fx.sibling, 'apps/a.ts')).status).toBe(0);
      expect(edit(path.join(fx.foreign, '.env')).status).toBe(0);
    });

    it('ignores an inherited GIT_DIR (a git hook running claude -p)', () => {
      // With GIT_DIR set, git takes the -C directory as the top of the work tree; an existing
      // docs/client/ would then become the root and the file would look like a plain `x.md`.
      mkdirSync(path.join(fx.main, 'docs/client'), { recursive: true });
      const env = { GIT_DIR: path.join(fx.main, '.git') };
      expect(edit(path.join(fx.main, 'docs/client/x.md'), env).status).toBe(2);
      expect(edit(path.join(fx.sibling, '.env'), env).status).toBe(2);
    });
  });
  it('exits 0 on malformed input instead of blocking everything', () => {
    const r = spawnSync('node', [path.join(hooks, 'protect-files.mjs')], {
      input: 'not json',
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });
});

describe('format-on-edit.mjs', () => {
  it('exits 0 for a file that does not exist', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'fmt-'));
    expect(
      run('format-on-edit.mjs', { tool_name: 'Edit', tool_input: { file_path: 'missing.ts' }, cwd })
        .status,
    ).toBe(0);
  });
  it('exits 0 for a file with a syntax error (formatter failure is never fatal)', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'fmt-'));
    writeFileSync(path.join(cwd, 'broken.ts'), 'const = ;\n');
    expect(
      run('format-on-edit.mjs', { tool_name: 'Edit', tool_input: { file_path: 'broken.ts' }, cwd })
        .status,
    ).toBe(0);
  });
  it('exits 0 for a non-code file without running anything', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'fmt-'));
    expect(
      run('format-on-edit.mjs', { tool_name: 'Write', tool_input: { file_path: 'notes.md' }, cwd })
        .status,
    ).toBe(0);
  });
  it('formats a real file inside the repository with eslint --fix and prettier', () => {
    const dir = path.join(repoRoot, 'tools/claude-plugin/tests/tmp');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `fmt-${process.pid}-${Date.now()}.mjs`);
    writeFileSync(file, 'const  x=1\nexport { x }\n');
    try {
      const r = run('format-on-edit.mjs', {
        tool_name: 'Write',
        tool_input: { file_path: file },
        cwd: repoRoot,
      });
      expect(r.status).toBe(0);
      expect(readFileSync(file, 'utf8')).toBe('const x = 1;\nexport { x };\n');
    } finally {
      rmSync(file, { force: true });
    }
  }, 60_000);
});

describe('verify-reminder.mjs', () => {
  it('exits 0 and prints nothing when stop_hook_active is true', () => {
    const r = run('verify-reminder.mjs', {
      hook_event_name: 'Stop',
      stop_hook_active: true,
      cwd: repoRoot,
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });
  it('exits 0 and prints nothing outside a git repository', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'nogit-'));
    const r = run('verify-reminder.mjs', { hook_event_name: 'Stop', stop_hook_active: false, cwd });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });
  it('emits non-blocking additionalContext when apps/ has uncommitted changes', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'git-'));
    execFileSync('git', ['init', '-q'], { cwd });
    mkdirSync(path.join(cwd, 'apps/x'), { recursive: true });
    writeFileSync(path.join(cwd, 'apps/x/a.ts'), 'export const a = 1;\n');
    const r = run('verify-reminder.mjs', { hook_event_name: 'Stop', stop_hook_active: false, cwd });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe('Stop');
    expect(out.hookSpecificOutput.additionalContext).toContain('pnpm verify');
    expect(out.decision).toBeUndefined();
  });
});
