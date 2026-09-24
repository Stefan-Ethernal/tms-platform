import { describe, expect, it } from 'vitest';
import {
  API_DOCKERFILE_PATH,
  CLAUDE_MD_MAX_LINES,
  claudeMdLineCount,
  findDuplicateCopies,
  findForbiddenDocuments,
  findUnscopedOptionalPruning,
  readSnapshotKeys,
  runHygiene,
} from './check-hygiene.mjs';

describe('findForbiddenDocuments', () => {
  it('flags pdf, pptx and docx outside docs/client regardless of case', () => {
    const files = [
      'README.md',
      'docs/spec.PDF',
      'apps/x/deck.pptx',
      'notes/a.Docx',
      'src/a.ts',
      'docs/clientele/x.pdf',
    ];
    expect(findForbiddenDocuments(files)).toEqual([
      'docs/spec.PDF',
      'apps/x/deck.pptx',
      'notes/a.Docx',
      'docs/clientele/x.pdf',
    ]);
  });

  it('flags legacy office, OpenDocument, Visio, CAD drawing and mail files regardless of case', () => {
    const files = [
      'a.doc',
      'b.PPT',
      'c.xls',
      'd.Xlsx',
      'e.odt',
      'f.ods',
      'g.odp',
      'h.vsd',
      'i.VSDX',
      'j.dwg',
      'k.msg',
      'l.eml',
    ];
    expect(findForbiddenDocuments(files)).toEqual(files);
  });

  it('flags every tracked file under docs/client/ except README.md', () => {
    expect(
      findForbiddenDocuments([
        'docs/client/a.pdf',
        'docs/client/sub/b.docx',
        'docs/client/notes.txt',
        'docs/client/README.md',
      ]),
    ).toEqual(['docs/client/a.pdf', 'docs/client/sub/b.docx', 'docs/client/notes.txt']);
  });

  it('does not flag look-alike names', () => {
    expect(
      findForbiddenDocuments([
        'report.pdf.txt',
        'docs/clientele/x.pdf.md',
        'pdfkit.ts',
        'docs/xlsx-export.ts',
        'src/email.ts',
        'msgpack.json',
      ]),
    ).toEqual([]);
  });
});

describe('readSnapshotKeys', () => {
  it('returns the quoted and unquoted keys of the snapshots section only', () => {
    const lockYaml = [
      "lockfileVersion: '9.0'",
      '',
      'packages:',
      '',
      "  '@nestjs/core@12.0.0':",
      '    resolution: {integrity: sha512-x}',
      '',
      'snapshots:',
      '',
      "  '@nestjs/common@12.1.0(reflect-metadata@0.2.2)(rxjs@7.8.2)':",
      '    dependencies:',
      '      iterare: 1.2.1',
      '',
      '  resolve-pkg-maps@1.0.0: {}',
      '',
      '  zod@4.6.5: {}',
      '',
    ].join('\n');
    expect(readSnapshotKeys(lockYaml)).toEqual([
      '@nestjs/common@12.1.0(reflect-metadata@0.2.2)(rxjs@7.8.2)',
      'resolve-pkg-maps@1.0.0',
      'zod@4.6.5',
    ]);
  });

  it('returns no keys for a lockfile without snapshots', () => {
    expect(readSnapshotKeys("lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n")).toEqual([]);
  });
});

describe('findDuplicateCopies', () => {
  it('accepts one snapshot per watched package and packages not installed yet', () => {
    const entries = [
      '@nestjs/common@12.1.0(reflect-metadata@0.2.2)(rxjs@7.8.2)',
      '@nestjs/core@12.1.0(@nestjs/common@12.1.0(reflect-metadata@0.2.2)(rxjs@7.8.2))(rxjs@7.8.2)',
      '@nestjs/testing@12.1.0(@nestjs/common@12.1.0)(@nestjs/core@12.1.0)',
    ];
    expect(findDuplicateCopies(entries)).toEqual([]);
  });

  it('reports a package that pnpm installed with two peer sets', () => {
    const entries = ['@nestjs/core@12.1.0(rxjs@7.8.2)(a@1.0.0)', '@nestjs/core@12.1.0(rxjs@7.8.2)'];
    expect(findDuplicateCopies(entries)).toEqual([
      {
        name: '@nestjs/core',
        copies: ['@nestjs/core@12.1.0(rxjs@7.8.2)', '@nestjs/core@12.1.0(rxjs@7.8.2)(a@1.0.0)'],
      },
    ]);
  });

  it('does not count packages that only share a name prefix', () => {
    const entries = [
      '@nestjs-cls/transactional@4.0.0(x@1.0.0)',
      '@nestjs-cls/transactional-adapter-prisma@2.0.0(x@1.0.0)',
      '@prisma/client@7.10.0(y@1.0.0)',
      '@prisma/client-runtime-utils@7.10.0',
      'nestjs-cls@7.0.0(z@1.0.0)',
    ];
    expect(findDuplicateCopies(entries)).toEqual([]);
  });
});

describe('claudeMdLineCount', () => {
  it('does not count a trailing newline as an extra line', () => {
    expect(claudeMdLineCount('a\nb\nc\n')).toBe(3);
  });
});

describe('findUnscopedOptionalPruning', () => {
  const scoped = [
    'RUN pnpm --filter "@tms/${APP}" deploy --legacy --prod /out \\',
    ' && rm -rf /out/node_modules/.pnpm/prisma@* /out/node_modules/.pnpm/@prisma+engines@*',
  ].join('\n');

  it('accepts a scoped removal with no --no-optional flag', () => {
    expect(findUnscopedOptionalPruning(scoped)).toEqual([]);
  });

  it('flags pnpm deploy --no-optional even when the scoped removal is also present', () => {
    const text = scoped.replace('deploy --legacy --prod', 'deploy --legacy --prod --no-optional');
    const problems = findUnscopedOptionalPruning(text);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/--no-optional/);
    expect(problems[0]).toContain(API_DOCKERFILE_PATH);
  });

  it('flags a missing scoped Prisma removal after deploy', () => {
    const text = 'RUN pnpm --filter "@tms/${APP}" deploy --legacy --prod /out';
    const problems = findUnscopedOptionalPruning(text);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/missing the explicit removal/);
  });

  it('reports both problems for a Dockerfile that regresses to --no-optional with nothing else', () => {
    const text = 'RUN pnpm --filter "@tms/${APP}" deploy --legacy --prod --no-optional /out';
    expect(findUnscopedOptionalPruning(text)).toHaveLength(2);
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

  it('does not report a CLAUDE.md exactly at the line limit', () => {
    expect(runHygiene({ trackedFiles: [], claudeMd: 'x\n'.repeat(CLAUDE_MD_MAX_LINES) })).toEqual(
      [],
    );
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

  it('reports a tracked file under docs/client/ with a distinct message', () => {
    const problems = runHygiene({ trackedFiles: ['docs/client/a.pdf'], claudeMd: '' });
    expect(problems).toEqual([
      'tracked file under docs/client/ (must stay untracked): docs/client/a.pdf',
    ]);
  });

  it('reports duplicate copies found in the installed lockfile', () => {
    const problems = runHygiene({
      trackedFiles: [],
      claudeMd: '',
      pnpmStoreEntries: ['@prisma/client@7.10.0(pg@8.23.0)', '@prisma/client@7.10.0(pg@8.24.0)'],
    });
    expect(problems).toEqual([
      '@prisma/client is installed 2 times (@prisma/client@7.10.0(pg@8.23.0), @prisma/client@7.10.0(pg@8.24.0)); align versions and peers so one copy remains',
    ]);
  });

  it('skips the single-copy check without node_modules/.pnpm/lock.yaml', () => {
    expect(runHygiene({ trackedFiles: [], claudeMd: '', pnpmStoreEntries: null })).toEqual([]);
  });

  it('reports a regressed api.Dockerfile that prunes optional dependencies with --no-optional', () => {
    const problems = runHygiene({
      trackedFiles: [],
      claudeMd: '',
      apiDockerfile: 'RUN pnpm --filter "@tms/${APP}" deploy --legacy --prod --no-optional /out',
    });
    expect(problems).toEqual([
      expect.stringContaining('--no-optional'),
      expect.stringContaining('missing the explicit removal'),
    ]);
  });

  it('skips the Dockerfile check without infra/docker/api.Dockerfile', () => {
    expect(runHygiene({ trackedFiles: [], claudeMd: '', apiDockerfile: null })).toEqual([]);
  });
});
