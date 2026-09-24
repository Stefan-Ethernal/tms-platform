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
    'serial',
    'serials',
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

  it.each(['otpauthUri', 'otpauth_uri', 'OtpauthURI'])(
    'matches the TOTP enrollment URI key %s (phase 2)',
    (key) => {
      expect(isSensitiveKey(key)).toBe(true);
    },
  );
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
    ['Authorization: Bearer [Filtered]', 'Authorization: Bearer [REDACTED]'],
    ['login failed password="hunter2" user=ana', 'login failed password=[REDACTED] user=ana'],
    ["login failed password='hunter2' user=ana", 'login failed password=[REDACTED] user=ana'],
    ['{"a":"token=","b":"x"}', '{"a":"token=","b":"x"}'],
    ['reason="bad pin=1234"', 'reason="bad pin=[REDACTED]"'],
    ['note="x password=hunter2" y', 'note="x password=[REDACTED]" y'],
    ["msg='a token=abc123' z", "msg='a token=[REDACTED]' z"],
    ['{"a":"q=\\"x pin=1\\""}', '{"a":"q=\\"x pin=[REDACTED]\\""}'],
    ['GET /x?token=[Filtered]&lang=en', 'GET /x?token=[REDACTED]&lang=en'],
    ['nothing to see here', 'nothing to see here'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(scrubString(input)).toBe(expected);
  });

  // The logger scrubs the finished JSON line, so a message's quotes arrive escaped (`\"`).
  it.each([
    ['login failed password="hunter2" user=ana', 'hunter2'],
    ["login failed password='hunter2' user=ana", 'hunter2'],
    ['header "Bearer abc123" rejected', 'abc123'],
    ['url "https://x/a?token=abc123" failed', 'abc123'],
    ['db "postgresql://tms:s3cret@db/tms" down', 's3cret'],
    ['token=abc123\nnext line', 'abc123'],
  ])('keeps a JSON log line valid and drops the secret: %s', (msg, secret) => {
    const line = scrubString(JSON.stringify({ msg, level: 30 }));
    expect(line).not.toContain(secret);
    expect(JSON.parse(line)).toEqual({ msg: scrubString(msg), level: 30 });
  });

  // A `"` after `key=` inside a JSON line is the closing quote of a string, so a quoted value must
  // never be read from there into the next string.
  it.each(['{"x pin=":" y"}', '{"a":"pin="," b":"c"}', '{"a":"token=","#b":1}', '["pin="," x"]'])(
    'never lets a quoted value span two JSON strings: %s',
    (line) => {
      const scrubbed = scrubString(line);
      expect(Object.keys(JSON.parse(scrubbed) as object)).toEqual(
        Object.keys(JSON.parse(line) as object),
      );
    },
  );

  it('is idempotent', () => {
    const once = scrubString('Bearer x token=y https://u:p@h/?pin=1 {"secret":"z"}');
    expect(scrubString(once)).toBe(once);
    expect(once).not.toMatch(/x|=y|u:p|pin=1|"z"/);
  });
});

describe('scrubString property', () => {
  interface Piece {
    readonly text: string;
    readonly secrets: readonly string[];
  }
  const SENSITIVE_KEYS = ['password', 'pin', 'token', 'cardSerial', 'totp', 'secret'];
  const SAFE_KEYS = ['note', 'reason', 'msg', 'q', 'shipping'];
  // No letter of `[REDACTED]`, so a generated secret is never a substring of the marker.
  const secret = fc.string({
    unit: fc.constantFrom(...'BFGHJKLMNPQSUVWXYZ'),
    minLength: 6,
    maxLength: 12,
  });
  const filler = fc
    .string({ unit: fc.constantFrom(...'abcxyz019 ",#&;)}]\\'), minLength: 1, maxLength: 8 })
    .map((text): Piece => ({ text, secrets: [] }));
  const join = (pieces: readonly Piece[]): Piece => ({
    text: pieces.map((p) => p.text).join(' '),
    secrets: pieces.flatMap((p) => p.secrets),
  });
  const pair = (quotes: readonly string[]) =>
    fc
      .tuple(fc.constantFrom(...SENSITIVE_KEYS), fc.constantFrom(...quotes), secret)
      .map(([key, q, value]): Piece => ({ text: `${key}=${q}${value}${q}`, secrets: [value] }));
  // A quoted value under a non-sensitive key; its pairs use another quote style, because a
  // same-style quote inside it would end it (ambiguous even for a human reader).
  const nested = fc.constantFrom('"', "'").chain((q) =>
    fc
      .tuple(
        fc.constantFrom(...SAFE_KEYS),
        fc.array(fc.oneof(filler, pair(['', q === '"' ? "'" : '"'])), {
          minLength: 1,
          maxLength: 3,
        }),
      )
      .map(([key, inner]): Piece => {
        const body = join(inner);
        return { text: `${key}=${q}${body.text}${q}`, secrets: body.secrets };
      }),
  );
  const message = fc
    .array(fc.oneof(filler, pair(['', '"', "'"]), nested), { minLength: 1, maxLength: 6 })
    .map(join);
  const record = fc.tuple(
    fc.array(fc.tuple(message, fc.oneof(message, fc.integer())), { minLength: 1, maxLength: 3 }),
    fc.array(message, { maxLength: 3 }),
  );

  it('property: a JSON log line stays valid, scrubbing is idempotent and no secret survives', () => {
    fc.assert(
      fc.property(record, ([fields, list]) => {
        const object: Record<string, unknown> = {};
        const secrets: string[] = [];
        for (const [key, value] of fields) {
          object[key.text] = typeof value === 'number' ? value : value.text;
          secrets.push(...key.secrets, ...(typeof value === 'number' ? [] : value.secrets));
        }
        object['list'] = list.map((m) => m.text);
        secrets.push(...list.flatMap((m) => m.secrets));
        const scrubbed = scrubString(JSON.stringify(object));
        expect(() => JSON.parse(scrubbed) as unknown).not.toThrow();
        expect(scrubString(scrubbed)).toBe(scrubbed);
        for (const value of secrets) expect(scrubbed).not.toContain(value);
      }),
      { numRuns: 500 },
    );
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
