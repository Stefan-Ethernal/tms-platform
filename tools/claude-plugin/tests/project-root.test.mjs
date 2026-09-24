import { mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { locate } from '../ethernal-nest-react/hooks/lib/project-root.mjs';
import { createWorktreeFixture } from './support/worktrees.mjs';

describe('locate', () => {
  let fx;
  beforeAll(() => {
    fx = createWorktreeFixture();
  });
  afterAll(() => fx.remove());
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** Locates `filePath` for a session started in `session`; returns the root and tree-relative path. */
  const from = (session, filePath) => {
    vi.stubEnv('CLAUDE_PROJECT_DIR', session);
    const { root, abs } = locate({ cwd: session }, filePath);
    return { root, rel: path.relative(root, abs) };
  };

  it('keeps a file in the checkout the session started in under that checkout', () => {
    expect(from(fx.main, path.join(fx.main, 'apps/a.ts'))).toEqual({
      root: fx.main,
      rel: 'apps/a.ts',
    });
  });

  it.each([
    ['a sibling worktree', (f) => [f.sibling, '.env']],
    ['a worktree nested under .claude/worktrees/', (f) => [f.nested, 'docs/client/x.md']],
    ['a directory not created yet', (f) => [f.sibling, 'new/deeper/.env.local']],
  ])('puts a file in %s under that worktree (9-M1)', (_name, where) => {
    const [root, rel] = where(fx);
    expect(from(fx.main, path.join(root, rel))).toEqual({ root, rel });
  });

  it('gives the tree-relative path through a symlinked session root', () => {
    const link = path.join(fx.base, 'link-main');
    symlinkSync(fx.main, link);
    expect(from(link, path.join(link, '.env'))).toEqual({ root: fx.main, rel: '.env' });
  });

  it('gives the tree-relative path through a symlink into a nested worktree', () => {
    const link = path.join(fx.base, 'link-base');
    symlinkSync(fx.base, link);
    const session = path.join(link, 'main');
    const file = path.join(session, '.claude/worktrees/agent-1/.env');
    expect(from(session, file)).toEqual({ root: fx.nested, rel: '.env' });
  });

  it('covers the whole work tree when the session started in a subdirectory', () => {
    const sub = path.join(fx.main, 'apps/x');
    mkdirSync(sub, { recursive: true });
    expect(from(sub, path.join(fx.main, 'docs/client/a.md'))).toEqual({
      root: fx.main,
      rel: 'docs/client/a.md',
    });
  });

  it('leaves files in an unrelated repository or outside any repository at the session root', () => {
    for (const file of [path.join(fx.foreign, '.env'), path.join(fx.base, 'loose/.env')]) {
      const { root, rel } = from(fx.main, file);
      expect(root).toBe(fx.main);
      expect(rel.startsWith('../')).toBe(true);
    }
  });

  it('resolves a relative path against the session root', () => {
    expect(from(fx.main, 'apps/a.ts')).toEqual({ root: fx.main, rel: 'apps/a.ts' });
  });
});
