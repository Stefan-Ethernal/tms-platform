import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

/** The directory Claude Code started in; the payload's cwd may be a subdirectory. */
export function sessionRoot(input) {
  return process.env['CLAUDE_PROJECT_DIR'] ?? input.cwd ?? process.cwd();
}

/**
 * The root of the work tree that holds `filePath`. A session started in the main checkout may edit
 * files in another worktree of the same repository (a sibling one, or one Claude Code nests under
 * `.claude/worktrees/`); those files belong to that worktree's root, not the session root (9-M1).
 * Files outside the session's repository, and calls without a path, keep the session root.
 *
 * @param {{ cwd?: string }} input the hook payload
 * @param {string | undefined} filePath absolute, or relative to the session root
 */
export function projectRoot(input, filePath) {
  const root = sessionRoot(input);
  if (!filePath) return root;
  const fileTree = gitTree(nearestExistingDir(path.dirname(path.resolve(root, filePath))));
  const sessionTree = gitTree(root);
  if (!fileTree || !sessionTree || fileTree.commonDir !== sessionTree.commonDir) return root;
  // Same work tree: keep the session root as given, so paths under a symlinked root still match.
  return fileTree.toplevel === sessionTree.toplevel ? root : fileTree.toplevel;
}

function nearestExistingDir(dir) {
  while (!existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  return dir;
}

/** @returns {{ toplevel: string, commonDir: string } | undefined} */
function gitTree(dir) {
  try {
    const [toplevel, commonDir] = execFileSync(
      'git',
      ['-C', dir, 'rev-parse', '--show-toplevel', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000 },
    )
      .trim()
      .split('\n');
    return { toplevel, commonDir: realpathSync(path.resolve(dir, commonDir)) };
  } catch {
    return undefined; // not a git work tree
  }
}
