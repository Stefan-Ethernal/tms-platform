// Pure and isomorphic: no Node imports. Used by the logger (pino redact + serializers), the
// Sentry beforeSend hook and the audit metadata test.

export const REDACTED = '[REDACTED]' as const;
export const CIRCULAR = '[Circular]' as const;
export const MAX_DEPTH_REACHED = '[MaxDepth]' as const;

/**
 * Words that mark a key as sensitive (spec section 11 plus the token, device and session
 * material of sections 8 and 9). Compared against whole words of the key, never substrings.
 * `serial` is the IdentityCard column itself, so `serialNumber` is over-redacted on purpose.
 */
export const SENSITIVE_KEY_TOKENS = [
  'password',
  'passwords',
  'passwd',
  'passphrase',
  'pin',
  'pins',
  'cardserial',
  'serial',
  'serials',
  'token',
  'tokens',
  'jwt',
  'authorization',
  'cookie',
  'cookies',
  'setcookie',
  'totp',
  'otp',
  'otpauth',
  'recoverycode',
  'recoverycodes',
  'secret',
  'secrets',
  'apikey',
  'devicekey',
  'sessionid',
] as const;

const TOKENS: ReadonlySet<string> = new Set(SENSITIVE_KEY_TOKENS);

/** `cardSerial` -> ['card', 'serial']; `Set-Cookie[]` -> ['set', 'cookie']; `PINCode` -> ['pin', 'code']. */
function wordsOf(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

/**
 * True when the key, split into words at camelCase boundaries and separators, contains a
 * sensitive word or an adjacent pair forming one (`card`+`serial`, `x-device-key`,
 * `recovery_code`). `tokenHash` and `tokenCount` match (the word `token`); `shipping`, `mapping`,
 * `keyId` and `footprint` do not because `pin`/`otp` are not whole words there.
 */
export function isSensitiveKey(key: string): boolean {
  const words = wordsOf(key);
  if (words.length === 0) return false;
  if (words.join('') === 'setcookie') return true;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? '';
    if (TOKENS.has(word)) return true;
    const next = words[i + 1];
    if (next !== undefined && TOKENS.has(word + next)) return true;
  }
  return false;
}

// Value classes never contain `\`: the logger scrubs finished JSON lines, where a message's quotes
// arrive as `\"`, and eating that backslash would leave an unescaped quote (invalid JSON).
// The alternative `\[[A-Za-z]+\]` keeps bracketed markers whole: a second pass leaves
// `[REDACTED]` alone and Sentry's `[Filtered]` becomes `[REDACTED]`, not `[REDACTED]]`.
const AUTH_SCHEME = /\b(bearer|basic|digest)\s+(\[[A-Za-z]+\]|[^\s,;"'\\)}\]]+)/gi;
const URL_CREDENTIALS = /(\/\/)([^\s/@:?#]+):([^\s/@?#]*)@/g;
// Values of `key=value`, first match wins: a bracketed marker; a quoted value escaped inside a
// JSON string (`\"…\"`, whole escape pairs only, the closing `\"` optional so an unterminated
// value is still taken up to the end of the JSON string); a plain `"…"` value; a plain `'…'`
// value; a bare value. A plain `"` after `key=` in a JSON line is always the closing quote of a
// string, followed (after optional whitespace) by `,`, `:`, `]` or `}`: the negative lookahead
// stops a plain quoted value from starting there and spanning into the next string. A `'…'` value
// cannot span strings because it never contains `"`.
const KEY_VALUE = new RegExp(
  String.raw`(^|[\s?&;,("'{[])([A-Za-z_][A-Za-z0-9_.\-[\]]{0,63})\s*=\s*(` +
    [
      String.raw`\[[A-Za-z]+\]`,
      String.raw`\\"((?:[^"\\]|\\[^"])*)(\\")?`,
      String.raw`"(?!\s*[,:\]}])((?:[^"\\]|\\.)*)"`,
      String.raw`'([^'"\\]*)'`,
      String.raw`[^\s&;,)"'}\]#\\]+`,
    ].join('|') +
    ')',
  'g',
);
const JSON_PAIR = /"([^"\\]{1,64})"\s*:\s*("(?:[^"\\]|\\.)*"|[^,}\]\s]+)/g;

/**
 * Prose form of a sensitive value: a sensitive word directly followed by `is`, `was` or `:`
 * and a token with no `=` (the `KEY_VALUE`/`JSON_PAIR` patterns above already cover `key=value`
 * and `"key":"value"`; this catches `password is hunter2` / `password: hunter2` — free text that
 * embeds a secret without an assignment operator). Reuses `SENSITIVE_KEY_TOKENS`, so it carries
 * the same whole-word-only, no-substring guarantee and the same accepted over-redaction of
 * `serial`/`pin`/`otp` as bare words. It also over-redacts the word right after "is"/"was"/":"
 * even when that word isn't itself a secret (e.g. "the password is required" redacts
 * "required") — accepted, same tradeoff already documented for `serial`/`pin` above; a more
 * precise heuristic (distinguishing "password is required" from "password is hunter2") isn't
 * worth the added complexity for a phase 2 defense-in-depth pass.
 *
 * The negative lookahead excludes `bearer`/`basic`/`digest` from the captured value: without it,
 * `Authorization: Bearer [REDACTED]` (already fully handled by `AUTH_SCHEME`, which runs first)
 * collides with the "authorization" + ":" case here and eats the scheme word itself, corrupting
 * an already-correct result into `Authorization: [REDACTED] [REDACTED]`.
 */
const SENSITIVE_PROSE = new RegExp(
  String.raw`\b(${SENSITIVE_KEY_TOKENS.join('|')})\b(\s*(?:is|was)\s+|\s*:\s*)(?!(?:bearer|basic|digest)\b)(\S+)`,
  'gi',
);

function scrubProse(text: string): string {
  return text.replace(
    SENSITIVE_PROSE,
    (_match, word: string, sep: string) => `${word}${sep}${REDACTED}`,
  );
}

/**
 * Redacts credentials embedded in free text: `Bearer x`, `//user:pass@`, `key=value` pairs,
 * JSON `"key":"value"` pairs whose key is sensitive, and prose (`password is hunter2`,
 * `secret: abc123`). Idempotent.
 */
export function scrubString(text: string): string {
  return scrubProse(scrubJsonPairs(scrubUrl(text.replace(AUTH_SCHEME, `$1 ${REDACTED}`))));
}

/** Redacts `user:password@` and sensitive query parameters of a URL (or any text holding one). */
export function scrubUrl(url: string): string {
  return scrubKeyValuePairs(url.replace(URL_CREDENTIALS, `$1${REDACTED}@`));
}

/**
 * A sensitive key loses its whole value. A non-sensitive key keeps its value, but a quoted value is
 * scrubbed inside (`reason="bad pin=1234"`), so a quote never shelters a pair. Groups 4–7 are the
 * inner text of the escaped (plus its closing `\"`), double-quoted and single-quoted alternatives.
 */
function scrubKeyValuePairs(text: string): string {
  return text.replace(
    KEY_VALUE,
    (
      match: string,
      lead: string,
      key: string,
      value: string,
      escaped: string | undefined,
      escapedClose: string | undefined,
      double: string | undefined,
      single: string | undefined,
    ) => {
      if (isSensitiveKey(key)) return `${lead}${key}=${REDACTED}`;
      const inner = escaped ?? double ?? single;
      if (inner === undefined || !inner.includes('=')) return match;
      const prefix = match.slice(0, match.length - value.length);
      if (escaped !== undefined)
        return `${prefix}\\"${scrubKeyValuePairs(escaped)}${escapedClose ?? ''}`;
      const quote = double !== undefined ? '"' : "'";
      return `${prefix}${quote}${scrubKeyValuePairs(inner)}${quote}`;
    },
  );
}

function scrubJsonPairs(text: string): string {
  return text.replace(JSON_PAIR, (match: string, key: string) =>
    isSensitiveKey(key) ? `"${key}":"${REDACTED}"` : match,
  );
}

export interface ScrubOptions {
  /** Nesting depth after which subtrees are replaced by `[MaxDepth]`; default 32. */
  readonly maxDepth?: number;
}

/**
 * Deep copy of `value` with every value under a sensitive key replaced by `[REDACTED]`, every
 * string leaf passed through `scrubString`, cycles cut with `[Circular]` and depth capped.
 * Arrays and objects (own enumerable keys) are walked; `Error` becomes a plain object with
 * name, scrubbed message and stack, walked `cause` and own properties; Date, ArrayBuffer views,
 * Map and Set are returned as they are.
 */
export function scrubDeep<T>(value: T, options: ScrubOptions = {}): T {
  return walk(value, options.maxDepth ?? 32, new WeakSet<object>()) as T;
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (
    value instanceof Date ||
    ArrayBuffer.isView(value) ||
    value instanceof Map ||
    value instanceof Set
  ) {
    return value;
  }
  if (seen.has(value)) return CIRCULAR;
  if (depth <= 0) return MAX_DEPTH_REACHED;
  seen.add(value);

  let result: unknown;
  if (Array.isArray(value)) {
    result = value.map((item) => walk(item, depth - 1, seen));
  } else {
    const out: Record<string, unknown> = {};
    if (value instanceof Error) {
      out['name'] = value.name;
      out['message'] = scrubString(value.message);
      if (typeof value.stack === 'string') out['stack'] = scrubString(value.stack);
      if (value.cause !== undefined) out['cause'] = walk(value.cause, depth - 1, seen);
    }
    for (const [key, item] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? REDACTED : walk(item, depth - 1, seen);
    }
    result = out;
  }

  seen.delete(value);
  return result;
}
