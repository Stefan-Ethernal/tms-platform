import { describe, expect, it } from 'vitest';
import { CLAUDE_MD_MAX_LINES, findForbiddenDocuments, runHygiene } from './check-hygiene.mjs';

describe('findForbiddenDocuments', () => {
  it('flags pdf, pptx and docx outside docs/client regardless of case', () => {
    const files = ['README.md', 'docs/spec.PDF', 'apps/x/deck.pptx', 'notes/a.Docx', 'src/a.ts'];
    expect(findForbiddenDocuments(files)).toEqual([
      'docs/spec.PDF',
      'apps/x/deck.pptx',
      'notes/a.Docx',
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

  it('reports a tracked file under docs/client/ with a distinct message', () => {
    const problems = runHygiene({ trackedFiles: ['docs/client/a.pdf'], claudeMd: '' });
    expect(problems).toEqual([
      'tracked file under docs/client/ (must stay untracked): docs/client/a.pdf',
    ]);
  });
});
