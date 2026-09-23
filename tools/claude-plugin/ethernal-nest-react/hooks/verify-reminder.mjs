#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readStdinJson } from './lib/stdin.mjs';
import { REMINDER, shouldRemind, WATCHED_DIRS } from './lib/reminder.mjs';
import { projectRoot } from './lib/project-root.mjs';

const input = await readStdinJson();
const root = projectRoot(input);

let porcelain = '';
try {
  porcelain = execFileSync('git', ['status', '--porcelain', '--', ...WATCHED_DIRS], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch {
  process.exit(0); // not a git repository: nothing to remind about
}

if (shouldRemind({ porcelain, stopHookActive: Boolean(input.stop_hook_active) })) {
  // Non-blocking guidance: shown as "Stop hook feedback", never as a hook error.
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: REMINDER } }),
  );
}
process.exit(0);
