import type { ExecutionContext } from '@nestjs/common';
import { OriginGuard } from '../src/http';

function ctx(method: string, headers: Record<string, string>): ExecutionContext {
  const req = { method, headers };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

// jest's asymmetric matchers type as `any`; cast once so `toThrow` sees a typed argument.
const rejectsOrigin = expect.objectContaining({ code: 'ORIGIN_REJECTED' }) as unknown as Error;

describe('OriginGuard (D11)', () => {
  const guard = new OriginGuard(['http://localhost:5173', 'http://localhost:8080']);

  it.each(['GET', 'HEAD', 'OPTIONS'])('lets safe method %s through without headers', (m) => {
    expect(guard.canActivate(ctx(m, {}))).toBe(true);
  });

  it.each([
    ['allowed Origin', { origin: 'http://localhost:5173' }, true],
    ['second allowed Origin', { origin: 'http://localhost:8080' }, true],
    ['same-origin fetch metadata without Origin', { 'sec-fetch-site': 'same-origin' }, true],
    ['foreign Origin', { origin: 'https://evil.example' }, false],
    ['Origin null', { origin: 'null' }, false],
    ['allowed prefix trick', { origin: 'http://localhost:5173.evil.example' }, false],
    ['same-site fetch metadata', { 'sec-fetch-site': 'same-site' }, false],
    ['none fetch metadata', { 'sec-fetch-site': 'none' }, false],
    ['no headers at all', {}, false],
    [
      'foreign Origin wins over same-origin metadata',
      { origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' },
      false,
    ],
  ])('POST with %s', (_name, headers, allowed) => {
    if (allowed) expect(guard.canActivate(ctx('POST', headers))).toBe(true);
    else expect(() => guard.canActivate(ctx('POST', headers))).toThrow(rejectsOrigin);
  });

  it.each(['PUT', 'PATCH', 'DELETE'])('guards %s like POST', (m) => {
    expect(() => guard.canActivate(ctx(m, {}))).toThrow(rejectsOrigin);
  });
});
