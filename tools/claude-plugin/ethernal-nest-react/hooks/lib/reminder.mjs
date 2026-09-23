const WATCHED = /^(apps|packages)\//;

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
      const target = spec.includes(' -> ') ? spec.split(' -> ')[1] : spec;
      return WATCHED.test(target);
    });
}

export const REMINDER =
  'apps/ or packages/ have uncommitted changes. Before finishing, run `pnpm verify` ' +
  '(or state explicitly why it was skipped) and report the actual result to the user.';
