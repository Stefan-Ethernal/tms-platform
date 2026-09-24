import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    stdio: 'ignore',
  });

/**
 * A repository with one commit, a sibling worktree (`<base>/sibling`), a worktree nested under
 * `.claude/worktrees/` the way Claude Code creates them, and an unrelated repository next to it.
 */
export function createWorktreeFixture() {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'wt-')));
  const main = path.join(base, 'main');
  const sibling = path.join(base, 'sibling');
  const nested = path.join(main, '.claude/worktrees/agent-1');
  const foreign = path.join(base, 'foreign');
  execFileSync('git', ['init', '-q', main]);
  git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(main, 'worktree', 'add', '-q', '-b', 'sibling', sibling);
  git(main, 'worktree', 'add', '-q', '-b', 'agent-1', nested);
  execFileSync('git', ['init', '-q', foreign]);
  return { base, main, sibling, nested, foreign };
}
