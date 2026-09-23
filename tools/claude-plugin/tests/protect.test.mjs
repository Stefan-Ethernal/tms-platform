import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyEdit } from '../ethernal-nest-react/hooks/lib/protect.mjs';

const cwd = '/work/tms-platform';

describe('classifyEdit', () => {
  it.each([
    '.env',
    'apps/api-admin/.env',
    'infra/.env',
    '.env.local',
    '.env.production',
    'packages/db/.env.test',
    'docs/client/functional-description.pdf',
    'docs/client/README.md',
    'docs/client/sub/notes.md',
    'DOCS/Client/x.pdf',
    'DOCS/CLIENT/x.pdf',
    '.ENV',
    'apps/api-admin/.ENV.LOCAL',
  ])('blocks %s', (p) => {
    const verdict = classifyEdit(p, cwd);
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain(p);
  });

  it.each([
    '.env.example',
    'apps/api-admin/.env.example',
    'infra/.env.example',
    '.env.production.example',
    'src/config/env.ts',
    'docs/clientele/notes.md',
    'docs/client-facing.md',
    'environment.ts',
    '.Env.Example',
    'DOCS/Clientele/x.pdf',
  ])('allows %s', (p) => {
    expect(classifyEdit(p, cwd)).toEqual({ blocked: false });
  });

  it('normalises absolute paths and traversal inside the project', () => {
    expect(classifyEdit(path.join(cwd, '.env'), cwd).blocked).toBe(true);
    expect(classifyEdit('apps/../docs/client/x.pdf', cwd).blocked).toBe(true);
    expect(classifyEdit(path.join(cwd, 'apps/api-admin/.env.example'), cwd).blocked).toBe(false);
  });

  it("ignores paths outside the project (not this hook's concern)", () => {
    expect(classifyEdit('/tmp/other/.env', cwd)).toEqual({ blocked: false });
    expect(classifyEdit('../sibling/docs/client/x.pdf', cwd)).toEqual({ blocked: false });
  });

  it('allows a missing path', () => {
    expect(classifyEdit(undefined, cwd)).toEqual({ blocked: false });
  });
});
