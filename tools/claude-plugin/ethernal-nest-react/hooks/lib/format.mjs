import path from 'node:path';

const FORMATTABLE = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = /(^|\/)(node_modules|dist|coverage|generated|\.turbo)\//;

/** @param {string | undefined} relPath */
export function shouldFormat(relPath) {
  if (!relPath) return false;
  const normalised = relPath.split(path.sep).join('/');
  if (SKIP_DIRS.test(normalised)) return false;
  return FORMATTABLE.has(path.posix.extname(normalised));
}
