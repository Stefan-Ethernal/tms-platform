#!/usr/bin/env node
import path from 'node:path';
import { readStdinJson } from './lib/stdin.mjs';
import { classifyEdit } from './lib/protect.mjs';
import { projectRoot, sessionRoot } from './lib/project-root.mjs';

const input = await readStdinJson();
const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
// Resolved against the session root before the work tree is picked, so a relative path means the
// same file whatever root it lands in (Claude Code itself always sends absolute paths).
const abs = filePath && path.resolve(sessionRoot(input), filePath);
const verdict = classifyEdit(abs, projectRoot(input, abs));
if (verdict.blocked) {
  process.stderr.write(`[ethernal-nest-react] blocked: ${verdict.reason}\n`);
  process.exit(2);
}
