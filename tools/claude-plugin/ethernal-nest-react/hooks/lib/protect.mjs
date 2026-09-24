import path from 'node:path';

const ENV_REASON =
  'env files hold secrets and are edited by hand; change the matching .env.example instead';
const CLIENT_REASON =
  'docs/client/ holds client documents that are never committed or modified by Claude';

/**
 * Decides whether an edit to `filePath` must be blocked (spec section 14 PreToolUse hook):
 * `.env`, `.env.*` except `*.example`, and everything under `docs/client/`.
 *
 * @param {string | undefined} filePath absolute or relative to `projectRoot`
 * @param {string} projectRoot the root of the work tree holding the file (see project-root.mjs),
 *   not the session cwd
 * @returns {{ blocked: boolean, reason?: string }}
 */
export function classifyEdit(filePath, projectRoot) {
  if (!filePath) return { blocked: false };
  const abs = path.resolve(projectRoot, filePath);
  const rel = path.relative(projectRoot, abs).split(path.sep).join('/');
  if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) return { blocked: false };

  // Folded to lower case only for comparison: case-insensitive filesystems (macOS APFS,
  // Windows/NTFS) treat differently-cased paths as the same file on disk, so classification
  // must not be foolable by case alone. `filePath` itself (used in the reason) stays untouched.
  const base = path.posix.basename(rel).toLowerCase();
  const relLower = rel.toLowerCase();
  if (base === '.env' || (base.startsWith('.env.') && !base.endsWith('.example'))) {
    return { blocked: true, reason: `${filePath}: ${ENV_REASON}` };
  }
  if (relLower.startsWith('docs/client/')) {
    return { blocked: true, reason: `${filePath}: ${CLIENT_REASON}` };
  }
  return { blocked: false };
}
