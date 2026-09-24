#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readStdinJson } from './lib/stdin.mjs';
import { shouldFormat } from './lib/format.mjs';
import { projectRoot, sessionRoot } from './lib/project-root.mjs';

const input = await readStdinJson();
const filePath = input.tool_input?.file_path;
if (!filePath) process.exit(0);
const root = projectRoot(input, filePath);

const abs = path.resolve(sessionRoot(input), filePath);
const rel = path.relative(root, abs);
if (rel.startsWith('..') || !shouldFormat(rel) || !existsSync(abs)) process.exit(0);

// Formatting is best effort: a parse error in a half-written file must never block Claude.
// Two runs of at most 25 s each fit the 60 s PostToolUse timeout in hooks.json.
const run = (args) => {
  try {
    execFileSync('pnpm', ['exec', ...args, abs], { cwd: root, stdio: 'ignore', timeout: 25_000 });
  } catch {
    /* ignored on purpose */
  }
};
run(['eslint', '--fix', '--no-warn-ignored']);
run(['prettier', '--write', '--log-level', 'warn']);
process.exit(0);
