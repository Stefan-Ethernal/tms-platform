#!/usr/bin/env node
import { readStdinJson } from './lib/stdin.mjs';
import { classifyEdit } from './lib/protect.mjs';
import { locate } from './lib/project-root.mjs';

const input = await readStdinJson();
const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
if (filePath) {
  const { root, abs } = locate(input, filePath);
  const verdict = classifyEdit(abs, root);
  if (verdict.blocked) {
    process.stderr.write(`[ethernal-nest-react] blocked: ${verdict.reason}\n`);
    process.exit(2);
  }
}
