#!/usr/bin/env node
/**
 * Repository hygiene (spec sections 13 and 14; public repository):
 *  - no client-type documents tracked outside docs/client/: PDF, Word, PowerPoint, Excel,
 *    OpenDocument, Visio, AutoCAD drawings and saved mail (FORBIDDEN_DOCUMENT_RE),
 *  - CLAUDE.md stays short,
 *  - packages whose classes must exist once per process are installed once
 *    (SINGLE_COPY_PACKAGES, read from the installed lockfile node_modules/.pnpm/lock.yaml;
 *    skipped without it, e.g. in the CI hygiene job).
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
/**
 * Nest's DI tokens and nestjs-cls' TransactionHost/ClsService are compared by class identity; a
 * second copy (another version or another peer-dependency set, i.e. another snapshot in the
 * installed lockfile) splits them silently. Packages not installed yet are fine.
 */
export const SINGLE_COPY_PACKAGES = [
  '@nestjs/common',
  '@nestjs/core',
  'nestjs-cls',
  '@nestjs-cls/transactional',
  '@prisma/client',
];

/** @param {string[]} trackedFiles */
export function findForbiddenDocuments(trackedFiles) {
  return trackedFiles.filter(
    (f) =>
      (FORBIDDEN_DOCUMENT_RE.test(f) && !f.startsWith(CLIENT_DOCS_DIR)) ||
      (f.startsWith(CLIENT_DOCS_DIR) && f !== `${CLIENT_DOCS_DIR}README.md`),
  );
}

/** @param {string} text */
export function claudeMdLineCount(text) {
  return text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
}

/**
 * Snapshot keys of pnpm's installed lockfile (node_modules/.pnpm/lock.yaml): one key per package
 * pnpm materialized, `<name>@<version>[(<peer>)…]`. The virtual-store directories are no source
 * of truth, because pnpm leaves orphaned ones behind after a version change. A line reader is
 * enough: pnpm writes each key at two spaces of indentation under the top-level `snapshots:`.
 *
 * @param {string} lockYaml
 * @returns {string[]}
 */
export function readSnapshotKeys(lockYaml) {
  const keys = [];
  let inSnapshots = false;
  for (const line of lockYaml.split('\n')) {
    if (/^\S/.test(line)) {
      inSnapshots = line.trimEnd() === 'snapshots:';
      continue;
    }
    const key = inSnapshots && /^ {2}(?:'([^']+)'|([^\s'][^:]*)):/.exec(line);
    if (key) keys.push(key[1] ?? key[2]);
  }
  return keys;
}

/**
 * @param {string[]} storeEntries snapshot keys of the installed lockfile (readSnapshotKeys)
 * @param {string[]} packages
 * @returns {{ name: string, copies: string[] }[]}
 */
export function findDuplicateCopies(storeEntries, packages = SINGLE_COPY_PACKAGES) {
  return packages.flatMap((name) => {
    // `<name>@` never matches a longer name that merely starts with `<name>`.
    const prefix = `${name}@`;
    const copies = storeEntries.filter((entry) => entry.startsWith(prefix)).sort();
    return copies.length > 1 ? [{ name, copies }] : [];
  });
}

/**
 * @param {{ trackedFiles: string[], claudeMd: string | null, pnpmStoreEntries?: string[] | null }} input
 *   `pnpmStoreEntries` (snapshot keys of the installed lockfile) is null when
 *   node_modules/.pnpm/lock.yaml does not exist (check skipped).
 */
export function runHygiene({ trackedFiles, claudeMd, pnpmStoreEntries = null }) {
  const problems = findForbiddenDocuments(trackedFiles).map((f) =>
    f.startsWith(CLIENT_DOCS_DIR)
      ? `tracked file under docs/client/ (must stay untracked): ${f}`
      : `client-type document outside docs/client/: ${f}`,
  );
  if (claudeMd !== null) {
    const lines = claudeMdLineCount(claudeMd);
    if (lines > CLAUDE_MD_MAX_LINES) {
      problems.push(
        `CLAUDE.md has ${lines} lines (max ${CLAUDE_MD_MAX_LINES}); move detail into docs/`,
      );
    }
  }
  if (pnpmStoreEntries !== null) {
    for (const { name, copies } of findDuplicateCopies(pnpmStoreEntries)) {
      problems.push(
        `${name} is installed ${copies.length} times (${copies.join(', ')}); align versions and peers so one copy remains`,
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
  const installedLockfile = path.join(repoRoot, 'node_modules', '.pnpm', 'lock.yaml');
  const pnpmStoreEntries = existsSync(installedLockfile)
    ? readSnapshotKeys(readFileSync(installedLockfile, 'utf8'))
    : null;

  const problems = runHygiene({ trackedFiles, claudeMd, pnpmStoreEntries });
  for (const p of problems) console.error(`hygiene: ${p}`);
  if (problems.length > 0) process.exit(1);
  const singleCopy = pnpmStoreEntries === null ? 'single-copy check skipped' : 'single copies ok';
  console.log(`hygiene: ok (${trackedFiles.length} tracked files, ${singleCopy})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
