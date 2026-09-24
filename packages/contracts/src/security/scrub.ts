// Pure and isomorphic: no Node imports. Used by the logger (pino redact + serializers), the
// Sentry beforeSend hook and the audit metadata test.

export const REDACTED = '[REDACTED]' as const;
export const CIRCULAR = '[Circular]' as const;
export const MAX_DEPTH_REACHED = '[MaxDepth]' as const;

/**
 * Words that mark a key as sensitive (spec section 11 plus the token, device and session
 * material of sections 8 and 9). Compared against whole words of the key, never substrings.
 */
export const SENSITIVE_KEY_TOKENS = [
  'password',
  'passwords',
  'passwd',
  'passphrase',
  'pin',
  'pins',
  'cardserial',
  'token',
  'tokens',
  'jwt',
  'authorization',
  'cookie',
  'cookies',
  'setcookie',
  'totp',
  'otp',
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

const AUTH_SCHEME = /\b(bearer|basic|digest)\s+(\[REDACTED\]|[^\s,;"')}\]]+)/gi;
const URL_CREDENTIALS = /(\/\/)([^\s/@:?#]+):([^\s/@?#]*)@/g;
// The value alternative `\[[A-Za-z]+\]` keeps bracketed markers whole: a second pass leaves
// `token=[REDACTED]` alone and Sentry's `token=[Filtered]` becomes `token=[REDACTED]`, not `…]]`.
const KEY_VALUE =
  /(^|[\s?&;,("'{[])([A-Za-z_][A-Za-z0-9_.\-[\]]{0,63})\s*=\s*(\[[A-Za-z]+\]|[^\s&;,)"'}\]#]+)/g;
const JSON_PAIR = /"([^"\\]{1,64})"\s*:\s*("(?:[^"\\]|\\.)*"|[^,}\]\s]+)/g;

/**
 * Redacts credentials embedded in free text: `Bearer x`, `//user:pass@`, `key=value` pairs and
 * JSON `"key":"value"` pairs whose key is sensitive. Idempotent.
 */
export function scrubString(text: string): string {
  return scrubJsonPairs(scrubUrl(text.replace(AUTH_SCHEME, `$1 ${REDACTED}`)));
}

/** Redacts `user:password@` and sensitive query parameters of a URL (or any text holding one). */
export function scrubUrl(url: string): string {
  return scrubKeyValuePairs(url.replace(URL_CREDENTIALS, `$1${REDACTED}@`));
}

function scrubKeyValuePairs(text: string): string {
  return text.replace(KEY_VALUE, (match: string, lead: string, key: string) =>
    isSensitiveKey(key) ? `${lead}${key}=${REDACTED}` : match,
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
