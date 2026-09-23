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
 * @param {string} projectRoot the project root (CLAUDE_PROJECT_DIR), not the session cwd
 * @returns {{ blocked: boolean, reason?: string }}
 */
export function classifyEdit(filePath, projectRoot) {
  if (!filePath) return { blocked: false };
  const abs = path.resolve(projectRoot, filePath);
  const rel = path.relative(projectRoot, abs).split(path.sep).join('/');
  if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) return { blocked: false };

  const base = path.posix.basename(rel);
  if (base === '.env' || (base.startsWith('.env.') && !base.endsWith('.example'))) {
    return { blocked: true, reason: `${filePath}: ${ENV_REASON}` };
  }
  if (rel.startsWith('docs/client/')) {
    return { blocked: true, reason: `${filePath}: ${CLIENT_REASON}` };
  }
  return { blocked: false };
}
