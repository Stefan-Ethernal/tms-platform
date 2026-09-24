import { symlinkSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { projectRoot } from '../ethernal-nest-react/hooks/lib/project-root.mjs';
import { createWorktreeFixture } from './support/worktrees.mjs';

describe('projectRoot', () => {
  let fx;
  beforeAll(() => {
    fx = createWorktreeFixture();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const fromMain = (filePath) => {
    vi.stubEnv('CLAUDE_PROJECT_DIR', fx.main);
    return projectRoot({ cwd: fx.main }, filePath);
  };

  it('is the session root for a file in the checkout the session started in', () => {
    expect(fromMain(path.join(fx.main, 'apps/a.ts'))).toBe(fx.main);
  });

  it('is the sibling worktree for a file in it (9-M1)', () => {
    expect(fromMain(path.join(fx.sibling, '.env'))).toBe(fx.sibling);
  });

  it('is the nested worktree for a file under .claude/worktrees/ (9-M1)', () => {
    expect(fromMain(path.join(fx.nested, 'docs/client/x.md'))).toBe(fx.nested);
  });

  it('uses the nearest existing directory for a file in a directory not created yet', () => {
    expect(fromMain(path.join(fx.sibling, 'new/deeper/.env.local'))).toBe(fx.sibling);
  });

  it('keeps the session root for a file in an unrelated repository', () => {
    expect(fromMain(path.join(fx.foreign, '.env'))).toBe(fx.main);
  });

  it('keeps the session root outside any repository and without a file path', () => {
    expect(fromMain(path.join(fx.base, 'loose/.env'))).toBe(fx.main);
    expect(fromMain(undefined)).toBe(fx.main);
  });

  it('keeps a symlinked session root as given for files in the same work tree', () => {
    const link = path.join(fx.base, 'link');
    symlinkSync(fx.main, link);
    vi.stubEnv('CLAUDE_PROJECT_DIR', link);
    expect(projectRoot({ cwd: link }, path.join(link, '.env'))).toBe(link);
  });

  it('resolves a relative path against the session root', () => {
    expect(fromMain('apps/a.ts')).toBe(fx.main);
  });
});
