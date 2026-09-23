#!/usr/bin/env node
/**
 * Repository hygiene (spec sections 13 and 14; public repository):
 *  - no *.pdf|*.pptx|*.docx tracked outside docs/client/,
 *  - CLAUDE.md stays short,
 *  - no forbidden term (the client's name) in tracked text; terms come from the gitignored
 *    docs/client/forbidden-terms.txt and/or the FORBIDDEN_TERMS env (CI secret). The term itself
 *    is never printed. `--staged` greps the index instead of the working tree (pre-commit).
 * Exit 1 with one line per problem.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN_DOCUMENT_RE = /\.(pdf|pptx|docx)$/i;
export const CLIENT_DOCS_DIR = 'docs/client/';
export const CLAUDE_MD_MAX_LINES = 150;
export const FORBIDDEN_TERMS_FILE = 'docs/client/forbidden-terms.txt';

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

/** @param {string} text newline- or comma-separated terms; a line whose trimmed text starts with `#` is a comment */
export function parseForbiddenTerms(text) {
  const withoutComments = text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  return [
    ...new Set(
      withoutComments
        .split(/[\n,]/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Word-bounded, case-insensitive fixed-string search over tracked text (or the index).
 * @param {{ repoRoot: string, terms: string[], staged: boolean }} input
 * @returns {string[]} `file:line` locations, never the matched text
 */
export function gitGrepForbidden({ repoRoot, terms, staged }) {
  if (terms.length === 0) return [];
  const args = ['grep', '-I', '-n', '-i', '-w', '-F'];
  if (staged) args.push('--cached');
  for (const term of terms) args.push('-e', term);
  args.push('--', '.', `:(exclude)${CLIENT_DOCS_DIR}`);
  try {
    const out = execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [file, lineNo] = line.split(':');
        return `${file}:${lineNo}`;
      });
  } catch (error) {
    if (error && error.status === 1) return []; // git grep: no match
    // Node's execFileSync error message embeds every argument verbatim (including each `-e
    // <term>`), and git's own stderr is intentionally discarded above; never let either reach the
    // caller (an uncaught exception here would print straight to CI logs on a public repo). The
    // original error is deliberately not attached as `cause`: its message contains the forbidden
    // term(s) verbatim.
    // eslint-disable-next-line preserve-caught-error -- see comment above; cause would leak the term
    throw new Error(`git grep failed (exit ${error?.status ?? 'unknown'})`);
  }
}

/** @param {{ trackedFiles: string[], claudeMd: string | null, forbiddenHits?: string[] }} input */
export function runHygiene({ trackedFiles, claudeMd, forbiddenHits = [] }) {
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
  for (const hit of forbiddenHits) problems.push(`forbidden term (client name) at ${hit}`);
  return problems;
}

function main() {
  const staged = process.argv.includes('--staged');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const trackedFiles = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const claudeMdPath = path.join(repoRoot, 'CLAUDE.md');
  const claudeMd = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, 'utf8') : null;

  const termsPath = path.join(repoRoot, FORBIDDEN_TERMS_FILE);
  const terms = parseForbiddenTerms(
    [
      process.env['FORBIDDEN_TERMS'] ?? '',
      existsSync(termsPath) ? readFileSync(termsPath, 'utf8') : '',
    ].join('\n'),
  );
  if (terms.length === 0) {
    console.warn(
      `hygiene: forbidden-terms check skipped (no ${FORBIDDEN_TERMS_FILE} and no FORBIDDEN_TERMS)`,
    );
  }
  const forbiddenHits = gitGrepForbidden({ repoRoot, terms, staged });

  const problems = runHygiene({ trackedFiles, claudeMd, forbiddenHits });
  for (const p of problems) console.error(`hygiene: ${p}`);
  if (problems.length > 0) process.exit(1);
  console.log(
    `hygiene: ok (${trackedFiles.length} tracked files, ${terms.length} forbidden terms${staged ? ', staged' : ''})`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
