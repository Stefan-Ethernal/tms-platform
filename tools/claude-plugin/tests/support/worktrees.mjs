import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway repositories: never sign with the developer's key, never follow an inherited GIT_DIR.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const git = (cwd, ...args) =>
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, env, stdio: 'ignore' },
  );

/**
 * A repository with one commit, a sibling worktree (`<base>/sibling`), a worktree nested under
 * `.claude/worktrees/` the way Claude Code creates them, and an unrelated repository next to it.
 * `base` is a real path; call `remove()` when done.
 */
export function createWorktreeFixture() {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'wt-')));
  const main = path.join(base, 'main');
  const sibling = path.join(base, 'sibling');
  const nested = path.join(main, '.claude/worktrees/agent-1');
  const foreign = path.join(base, 'foreign');
  git(base, 'init', '-q', main);
  git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(main, 'worktree', 'add', '-q', '-b', 'sibling', sibling);
  git(main, 'worktree', 'add', '-q', '-b', 'agent-1', nested);
  git(base, 'init', '-q', foreign);
  const remove = () => rmSync(base, { recursive: true, force: true });
  return { base, main, sibling, nested, foreign, remove };
}
