import type { IncomingMessage, ServerResponse } from 'node:http';
import pino, { type LogFn } from 'pino';
import {
  REDACTED,
  isSensitiveKey,
  scrubDeep,
  scrubString,
  scrubUrl,
} from '@tms/contracts/security';

// pino calls formatters.log / formatters.bindings BEFORE the serializers, so these keys still hold
// raw IncomingMessage / ServerResponse / Error objects there; their serializers scrub them.
const SERIALIZED_KEYS: ReadonlySet<string> = new Set(['req', 'res', 'err']);

/** formatters.log and formatters.bindings: every field except the serializer-owned ones. */
export function scrubLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SERIALIZED_KEYS.has(key)) scrubbed[key] = value;
    else scrubbed[key] = isSensitiveKey(key) ? REDACTED : scrubDeep(value);
  }
  return scrubbed;
}

/** hooks.logMethod: the message and the interpolation arguments, before pino formats them. */
export function scrubLogArguments(args: Parameters<LogFn>): Parameters<LogFn> {
  return (args as unknown[]).map((arg, index) => {
    if (typeof arg === 'string') return scrubString(arg);
    // Index 0 is the merging object (formatters.log handles it); later objects feed %j / %o.
    if (index > 0 && typeof arg === 'object' && arg !== null) return scrubDeep(arg);
    return arg;
  }) as Parameters<LogFn>;
}

/** `req`: id, method, URL without query secrets, scrubbed headers, remote address. Never the body. */
export function serializeRequest(value: unknown): Record<string, unknown> {
  const req = pino.stdSerializers.req(value as IncomingMessage);
  return {
    id: req.id,
    method: req.method,
    url: typeof req.url === 'string' ? scrubUrl(req.url) : req.url,
    headers: scrubDeep(req.headers),
    remoteAddress: req.remoteAddress,
  };
}

/** `res`: the status code only; response headers (Set-Cookie) are never logged. */
export function serializeResponse(value: unknown): Record<string, unknown> {
  return { statusCode: (value as Partial<ServerResponse>).statusCode };
}

/** `err`: pino's standard shape (type, message and stack with causes, own properties), scrubbed. */
export function serializeError(value: unknown): unknown {
  return scrubDeep(value instanceof Error ? pino.stdSerializers.err(value) : value);
}
