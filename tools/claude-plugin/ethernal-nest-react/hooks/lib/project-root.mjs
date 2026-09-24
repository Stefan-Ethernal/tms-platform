import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** The directory Claude Code started in; the payload's cwd may be a subdirectory. */
export function sessionRoot(input) {
  return process.env['CLAUDE_PROJECT_DIR'] ?? input.cwd ?? process.cwd();
}

/**
 * Where an edited file lives: the root of its work tree and the file's path re-expressed under that
 * root, so `path.relative(root, abs)` is the tree-relative path even through symlinks or a session
 * started in a subdirectory. A session in the main checkout may edit files in another worktree of
 * the same repository (a sibling one, or one Claude Code nests under `.claude/worktrees/`); those
 * belong to that worktree (9-M1). Files outside the session's repository, and any git failure, keep
 * the session root and the path as given.
 *
 * @param {{ cwd?: string }} input the hook payload
 * @param {string} filePath absolute, or relative to the session root
 * @returns {{ root: string, abs: string }}
 */
export function locate(input, filePath) {
  const root = sessionRoot(input);
  const abs = path.resolve(root, filePath);
  const existing = nearestExistingDir(path.dirname(abs));
  const fileTree = gitTree(existing);
  const sessionTree = fileTree && gitTree(root);
  if (!fileTree || fileTree.commonDir !== sessionTree?.commonDir) return { root, abs };
  return {
    root: fileTree.toplevel,
    abs: path.join(fileTree.toplevel, fileTree.prefix, path.relative(existing, abs)),
  };
}

function nearestExistingDir(dir) {
  while (!existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  return dir;
}

// Inherited GIT_DIR / GIT_WORK_TREE (hooks that run `claude -p`) would override the -C lookup.
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
);

/** @returns {{ toplevel: string, commonDir: string, prefix: string } | undefined} */
function gitTree(dir) {
  try {
    const out = execFileSync(
      'git',
      [
        '-C',
        dir,
        'rev-parse',
        '--path-format=absolute',
        '--show-toplevel',
        '--git-common-dir',
        '--show-prefix',
      ],
      { encoding: 'utf8', env: gitEnv, stdio: ['ignore', 'pipe', 'ignore'], timeout: 2_000 },
    );
    const [toplevel, commonDir, prefix = ''] = out.split('\n');
    return { toplevel, commonDir, prefix };
  } catch {
    return undefined; // not a git work tree, or git is unavailable
  }
}
