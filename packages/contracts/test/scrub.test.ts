import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CIRCULAR,
  isSensitiveKey,
  MAX_DEPTH_REACHED,
  REDACTED,
  scrubDeep,
  scrubString,
  scrubUrl,
} from '../src/security/scrub.js';

describe('isSensitiveKey', () => {
  it.each([
    'password',
    'Password',
    'PASSWORD',
    'passwd',
    'user_password',
    'passwordConfirmation',
    'pin',
    'PIN',
    'newPin',
    'pin_hash',
    'pinHash',
    'PINCode',
    'cardSerial',
    'card_serial',
    'card-serial',
    'CardSerial',
    'token',
    'tokenHash',
    'tokenCount',
    'accessToken',
    'refresh_token',
    'actionTokenId',
    'jwt',
    'authorization',
    'Authorization',
    'x-authorization',
    'cookie',
    'Cookie',
    'set-cookie',
    'Set-Cookie',
    'Set-Cookie[]',
    'cookies',
    'totp',
    'totpSecretEnc',
    'otp',
    'otpCode',
    'recoveryCode',
    'recovery_code',
    'recoveryCodes',
    'secret',
    'SECRETS_ENC_KEY',
    'clientSecret',
    'apiKey',
    'x-api-key',
    'X-Device-Key',
    'deviceKey',
    'sessionId',
    'session_id',
  ])('matches %s', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    'shipping',
    'shippingAddress',
    'mapping',
    'keyId',
    'footprint',
    'hotplug',
    'spinner',
    'pinned',
    'email',
    'username',
    'userId',
    'roleId',
    'kioskId',
    'sessionCount',
    'reason',
    'loadingPointId',
    'sequenceNumber',
    'failedAttempts',
    'lockedUntil',
    'name',
    'id',
    '',
    'x',
    'tokenizer',
    'protoplasm',
    'opinion',
  ])('does not match %s', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe('scrubString', () => {
  it.each([
    ['Authorization: Bearer eyJhbGciOi.abc_def-ghi', 'Authorization: Bearer [REDACTED]'],
    ['basic dXNlcjpwYXNz', 'basic [REDACTED]'],
    ['postgresql://tms:s3cret@db:5432/tms', 'postgresql://[REDACTED]@db:5432/tms'],
    ['https://user:@host/', 'https://[REDACTED]@host/'],
    ['GET /api/accept?token=abc123&lang=en', 'GET /api/accept?token=[REDACTED]&lang=en'],
    ['GET /x?pin=1234', 'GET /x?pin=[REDACTED]'],
    ['GET /x?shipping=fast&mapping=1', 'GET /x?shipping=fast&mapping=1'],
    ['login failed password=hunter2 user=ana', 'login failed password=[REDACTED] user=ana'],
    [
      'body {"password":"hunter2","email":"a@b.c"}',
      'body {"password":"[REDACTED]","email":"a@b.c"}',
    ],
    ['{"pin": 1234, "kioskId": "k1"}', '{"pin":"[REDACTED]", "kioskId": "k1"}'],
    ['{"totp":"12 34\\"56"}', '{"totp":"[REDACTED]"}'],
    ['token=[Filtered]', 'token=[REDACTED]'],
    ['GET /x?token=[Filtered]&lang=en', 'GET /x?token=[REDACTED]&lang=en'],
    ['nothing to see here', 'nothing to see here'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(scrubString(input)).toBe(expected);
  });

  it('is idempotent', () => {
    const once = scrubString('Bearer x token=y https://u:p@h/?pin=1 {"secret":"z"}');
    expect(scrubString(once)).toBe(once);
    expect(once).not.toMatch(/x|=y|u:p|pin=1|"z"/);
  });
});

describe('scrubUrl', () => {
  it('redacts credentials and sensitive query parameters, keeps the rest', () => {
    expect(scrubUrl('https://ana:pw@example.com/a?b=1&token=t&cardSerial=42#frag')).toBe(
      'https://[REDACTED]@example.com/a?b=1&token=[REDACTED]&cardSerial=[REDACTED]#frag',
    );
    expect(scrubUrl('/api/health')).toBe('/api/health');
  });
});

describe('scrubDeep', () => {
  it('redacts nested and array values under sensitive keys and keeps the others', () => {
    const input = {
      user: { name: 'Ana', password: 'hunter2', pin: 1234 },
      cards: [{ cardSerial: 'ABC', label: 'main' }],
      headers: { Authorization: 'Bearer x', 'Set-Cookie': ['sid=1'], 'x-request-id': 'r1' },
      shipping: { pin: 'still redacted', address: 'Street 1' },
      count: 3,
      when: new Date(0),
      bytes: new Uint8Array([1, 2, 3]),
    };
    const out = scrubDeep(input);
    expect(out).toEqual({
      user: { name: 'Ana', password: REDACTED, pin: REDACTED },
      cards: [{ cardSerial: REDACTED, label: 'main' }],
      headers: { Authorization: REDACTED, 'Set-Cookie': REDACTED, 'x-request-id': 'r1' },
      shipping: { pin: REDACTED, address: 'Street 1' },
      count: 3,
      when: new Date(0),
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(out).not.toBe(input);
    expect(out.user).not.toBe(input.user);
    expect(JSON.stringify(out)).not.toMatch(/hunter2|1234|ABC|Bearer x|sid=1/);
  });

  it('scrubs string leaves under non-sensitive keys (URLs, messages)', () => {
    expect(scrubDeep({ url: '/accept?token=abc', msg: 'Bearer zzz' })).toEqual({
      url: `/accept?token=${REDACTED}`,
      msg: `Bearer ${REDACTED}`,
    });
  });

  it('cuts cycles and caps depth', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a['self'] = a;
    expect(scrubDeep(a)).toEqual({ name: 'a', self: CIRCULAR });
    const shared = { ok: true };
    expect(scrubDeep({ x: shared, y: shared })).toEqual({ x: { ok: true }, y: { ok: true } });
    expect(scrubDeep({ a: { b: { c: 1 } } }, { maxDepth: 2 })).toEqual({
      a: { b: MAX_DEPTH_REACHED },
    });
  });

  it('turns an Error into a plain object with scrubbed message, stack, cause and own props', () => {
    const cause = new Error('db: postgresql://tms:pw@db/tms');
    const error = new Error('request failed token=abc', { cause }) as Error & { config: unknown };
    error.config = { headers: { authorization: 'Bearer x' }, url: '/y?pin=1' };
    const out = scrubDeep(error) as unknown as Record<string, unknown>;
    expect(out['name']).toBe('Error');
    expect(out['message']).toBe(`request failed token=${REDACTED}`);
    expect(out['stack']).toMatch(/^Error: request failed token=\[REDACTED\]/);
    expect(out['cause']).toMatchObject({
      name: 'Error',
      message: `db: postgresql://${REDACTED}@db/tms`,
    });
    expect(out['config']).toEqual({
      headers: { authorization: REDACTED },
      url: `/y?pin=${REDACTED}`,
    });
    expect(JSON.stringify(out)).not.toMatch(/abc|:pw@|Bearer x|pin=1/);
  });

  it('returns primitives, Map and Set untouched', () => {
    expect(scrubDeep(5)).toBe(5);
    expect(scrubDeep(null)).toBeNull();
    const map = new Map([['k', 'v']]);
    expect(scrubDeep(map)).toBe(map);
  });

  const SENSITIVE_KEYS = [
    'password',
    'pin',
    'cardSerial',
    'token',
    'authorization',
    'cookie',
    'totp',
    'recoveryCode',
  ];
  const SAFE_KEYS = ['name', 'email', 'shipping', 'mapping', 'keyId', 'count', 'items', 'user'];
  const safeString = fc.string({
    unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 '),
    maxLength: 12,
  });
  const leaf = fc.oneof(safeString, fc.integer(), fc.boolean(), fc.constant(null));
  const tree = fc.letrec<{ node: unknown }>((tie) => ({
    node: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      leaf,
      fc.array(tie('node'), { maxLength: 4 }),
      fc.dictionary(fc.constantFrom(...SAFE_KEYS), tie('node'), { maxKeys: 4 }),
    ),
  })).node;
  const secret = fc.string({
    unit: fc.constantFrom(...'ABCDEFGHJKLMNPQRSTUVWXYZ'),
    minLength: 8,
    maxLength: 16,
  });

  it('property: a secret planted under a sensitive key at any depth never survives, other leaves are unchanged', () => {
    fc.assert(
      fc.property(
        tree,
        fc.array(fc.oneof(fc.constantFrom(...SAFE_KEYS), fc.nat({ max: 3 })), { maxLength: 6 }),
        fc.constantFrom(...SENSITIVE_KEYS),
        secret,
        (base, path, sensitiveKey, planted) => {
          const root: unknown = JSON.parse(JSON.stringify(base));
          let cursor: unknown = root;
          let parent: unknown = undefined;
          let parentKey: string | number = '';
          for (const step of path) {
            if (typeof cursor !== 'object' || cursor === null) break;
            const key = Array.isArray(cursor)
              ? typeof step === 'number'
                ? step % Math.max(cursor.length, 1)
                : 0
              : String(step);
            parent = cursor;
            parentKey = key;
            cursor = (cursor as Record<string | number, unknown>)[key];
          }
          const host: Record<string, unknown> = { [sensitiveKey]: planted };
          let subject: unknown;
          if (parent === undefined) subject = host;
          else {
            (parent as Record<string | number, unknown>)[parentKey] = host;
            subject = root;
          }
          const scrubbed = scrubDeep(subject);
          const text = JSON.stringify(scrubbed);
          expect(text).not.toContain(planted);
          expect(JSON.stringify(scrubDeep(base))).toBe(JSON.stringify(base));
        },
      ),
      { numRuns: 300 },
    );
  });
});
