import { describe, expect, it } from 'vitest';
import { shouldFormat } from '../ethernal-nest-react/hooks/lib/format.mjs';

describe('shouldFormat', () => {
  it.each(['src/a.ts', 'src/a.tsx', 'x.mts', 'x.cts', 'hooks/h.mjs', 'a.cjs', 'a.js', 'a.jsx'])(
    'formats %s',
    (p) => expect(shouldFormat(p)).toBe(true),
  );
  it.each(['README.md', 'a.json', 'a.yml', 'a.prisma', 'Dockerfile', 'a.ts.md'])('skips %s', (p) =>
    expect(shouldFormat(p)).toBe(false),
  );
  it.each([
    'node_modules/x/a.ts',
    'apps/x/dist/a.js',
    'packages/db/generated/client.ts',
    '.turbo/a.js',
    'coverage/a.js',
  ])('skips generated or vendored %s', (p) => expect(shouldFormat(p)).toBe(false));
  it('skips a missing path', () => expect(shouldFormat(undefined)).toBe(false));
});
