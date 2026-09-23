import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_MD_MAX_LINES,
  findForbiddenDocuments,
  gitGrepForbidden,
  parseForbiddenTerms,
  runHygiene,
} from './check-hygiene.mjs';

describe('parseForbiddenTerms', () => {
  it('splits on newlines and commas, trims, drops blanks and comments', () => {
    expect(parseForbiddenTerms('# client names\nAcme\n acme corp ,ACME-X\n\n')).toEqual([
      'Acme',
      'acme corp',
      'ACME-X',
    ]);
  });
  it('returns an empty list for empty input', () => {
    expect(parseForbiddenTerms('')).toEqual([]);
  });
  it('ignores commas inside a comment line', () => {
    expect(parseForbiddenTerms('# names, one per line\nAcme')).toEqual(['Acme']);
  });
});

describe('gitGrepForbidden', () => {
  function tempRepo() {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hyg-'));
    const git = (...args) =>
      execFileSync('git', args, {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    return { dir, git };
  }

  it('reports file:line of a tracked hit, case-insensitively and word-bounded, without the text', () => {
    const { dir, git } = tempRepo();
    writeFileSync(
      path.join(dir, 'a.md'),
      'first line\nBuilt for ZORGCORP in 2026\nzorgcorporation is a different word\n',
    );
    git('add', 'a.md');
    git('commit', '-qm', 'x');
    const hits = gitGrepForbidden({ repoRoot: dir, terms: ['zorgcorp'], staged: false });
    expect(hits).toEqual(['a.md:2']);
  });

  it('ignores docs/client and returns nothing when nothing matches', () => {
    const { dir, git } = tempRepo();
    writeFileSync(path.join(dir, 'clean.md'), 'nothing here\n');
    execFileSync('mkdir', ['-p', path.join(dir, 'docs/client')]);
    writeFileSync(path.join(dir, 'docs/client/README.md'), 'zorgcorp appears here legitimately\n');
    git('add', '.');
    git('commit', '-qm', 'x');
    expect(gitGrepForbidden({ repoRoot: dir, terms: ['zorgcorp'], staged: false })).toEqual([]);
  });

  it('greps staged content with staged: true and skips git entirely without terms', () => {
    const { dir, git } = tempRepo();
    writeFileSync(path.join(dir, 'b.ts'), '// zorgcorp\n');
    git('add', 'b.ts');
    expect(gitGrepForbidden({ repoRoot: dir, terms: ['zorgcorp'], staged: true })).toEqual([
      'b.ts:1',
    ]);
    expect(gitGrepForbidden({ repoRoot: '/nonexistent', terms: [], staged: true })).toEqual([]);
  });

  it('never leaks a forbidden term in the thrown error when git grep fails for a reason other than no-match', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hyg-')); // not a git repo: no `git init`
    let thrown;
    try {
      gitGrepForbidden({ repoRoot: dir, terms: ['DUMMY_TERM_FOR_TEST'], staged: false });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).not.toContain('DUMMY_TERM_FOR_TEST');
    expect(thrown.cause).toBeUndefined();
  });
});

describe('findForbiddenDocuments', () => {
  it('flags pdf, pptx and docx outside docs/client regardless of case', () => {
    const files = ['README.md', 'docs/spec.PDF', 'apps/x/deck.pptx', 'notes/a.Docx', 'src/a.ts'];
    expect(findForbiddenDocuments(files)).toEqual([
      'docs/spec.PDF',
      'apps/x/deck.pptx',
      'notes/a.Docx',
    ]);
  });

  it('allows documents anywhere under docs/client/', () => {
    expect(findForbiddenDocuments(['docs/client/a.pdf', 'docs/client/sub/b.docx'])).toEqual([]);
  });

  it('does not flag look-alike names', () => {
    expect(
      findForbiddenDocuments(['report.pdf.txt', 'docs/clientele/x.pdf.md', 'pdfkit.ts']),
    ).toEqual([]);
  });
});

describe('runHygiene', () => {
  it('reports nothing for a clean repository', () => {
    expect(runHygiene({ trackedFiles: ['a.ts'], claudeMd: 'short\n' })).toEqual([]);
  });

  it('reports an over-long CLAUDE.md with its line count', () => {
    const claudeMd = Array.from({ length: CLAUDE_MD_MAX_LINES + 1 }, (_, i) => `line ${i}`).join(
      '\n',
    );
    const problems = runHygiene({ trackedFiles: [], claudeMd });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(new RegExp(`CLAUDE.md has ${CLAUDE_MD_MAX_LINES + 1} lines`));
  });

  it('tolerates a missing CLAUDE.md', () => {
    expect(runHygiene({ trackedFiles: [], claudeMd: null })).toEqual([]);
  });

  it('reports every forbidden document on its own line', () => {
    const problems = runHygiene({ trackedFiles: ['x.pdf', 'y.docx'], claudeMd: '' });
    expect(problems).toEqual([
      'client-type document outside docs/client/: x.pdf',
      'client-type document outside docs/client/: y.docx',
    ]);
  });

  it('reports forbidden-term hits by location only', () => {
    const problems = runHygiene({
      trackedFiles: [],
      claudeMd: '',
      forbiddenHits: ['README.md:12', 'docs/adr/0001.md:3'],
    });
    expect(problems).toEqual([
      'forbidden term (client name) at README.md:12',
      'forbidden term (client name) at docs/adr/0001.md:3',
    ]);
  });
});
