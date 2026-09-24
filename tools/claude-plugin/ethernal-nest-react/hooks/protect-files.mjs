#!/usr/bin/env node
import { readStdinJson } from './lib/stdin.mjs';
import { classifyEdit } from './lib/protect.mjs';
import { projectRoot } from './lib/project-root.mjs';

const input = await readStdinJson();
const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
const verdict = classifyEdit(filePath, projectRoot(input));
if (verdict.blocked) {
  process.stderr.write(`[ethernal-nest-react] blocked: ${verdict.reason}\n`);
  process.exit(2);
}
