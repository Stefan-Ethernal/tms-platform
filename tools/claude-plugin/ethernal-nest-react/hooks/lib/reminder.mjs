// Single source of truth for the directories this hook watches: the regex below and the
// `git status -- <pathspec>` call in verify-reminder.mjs both derive from this list.
export const WATCHED_DIRS = ['apps', 'packages'];
const WATCHED = new RegExp(`^(${WATCHED_DIRS.join('|')})/`);

/**
 * @param {{ porcelain: string, stopHookActive: boolean }} input
 *   porcelain: output of `git status --porcelain`; stopHookActive: true when a Stop hook already
 *   ran for this stop (remind at most once per stop).
 */
export function shouldRemind({ porcelain, stopHookActive }) {
  if (stopHookActive) return false;
  return porcelain
    .split('\n')
    .filter((line) => line.length > 3)
    .some((line) => {
      const spec = line.slice(3).trim();
      const raw = spec.includes(' -> ') ? spec.split(' -> ')[1] : spec;
      // `git status --porcelain` wraps a path containing spaces or other special characters in
      // double quotes; strip them so the watched-directory prefix check still matches.
      const target = raw.replace(/^"(.*)"$/, '$1');
      return WATCHED.test(target);
    });
}

export const REMINDER =
  'apps/ or packages/ have uncommitted changes. Before finishing, run `pnpm verify` ' +
  '(or state explicitly why it was skipped) and report the actual result to the user.';
