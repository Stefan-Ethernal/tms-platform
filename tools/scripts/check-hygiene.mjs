#!/usr/bin/env node
/**
 * Repository hygiene (spec sections 13 and 14; public repository):
 *  - no client-type documents tracked outside docs/client/: PDF, Word, PowerPoint, Excel,
 *    OpenDocument, Visio, AutoCAD drawings and saved mail (FORBIDDEN_DOCUMENT_RE),
 *  - CLAUDE.md stays short.
 * The client's name is kept out of the repository by convention, not by this script
 * (ADR 0007). Exit 1 with one line per problem.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN_DOCUMENT_RE =
  /\.(pdf|doc|docx|ppt|pptx|xls|xlsx|odt|ods|odp|vsd|vsdx|dwg|msg|eml)$/i;
export const CLIENT_DOCS_DIR = 'docs/client/';
export const CLAUDE_MD_MAX_LINES = 150;

/** @param {string[]} trackedFiles */
export function findForbiddenDocuments(trackedFiles) {
  return trackedFiles.filter(
    (f) => FORBIDDEN_DOCUMENT_RE.test(f) && !f.startsWith(CLIENT_DOCS_DIR),
  );
}

/** @param {string} text */
export function claudeMdLineCount(text) {
  return text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
}

/** @param {{ trackedFiles: string[], claudeMd: string | null }} input */
export function runHygiene({ trackedFiles, claudeMd }) {
  const problems = findForbiddenDocuments(trackedFiles).map(
    (f) => `client-type document outside docs/client/: ${f}`,
  );
  if (claudeMd !== null) {
    const lines = claudeMdLineCount(claudeMd);
    if (lines > CLAUDE_MD_MAX_LINES) {
      problems.push(
        `CLAUDE.md has ${lines} lines (max ${CLAUDE_MD_MAX_LINES}); move detail into docs/`,
      );
    }
  }
  return problems;
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const trackedFiles = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const claudeMdPath = path.join(repoRoot, 'CLAUDE.md');
  const claudeMd = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, 'utf8') : null;

  const problems = runHygiene({ trackedFiles, claudeMd });
  for (const p of problems) console.error(`hygiene: ${p}`);
  if (problems.length > 0) process.exit(1);
  console.log(`hygiene: ok (${trackedFiles.length} tracked files)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
