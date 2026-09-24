import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';
/** At most 64 characters of `[A-Za-z0-9._-]`: no CR/LF, no spaces, safe in headers and logs. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

type RequestWithId = IncomingMessage & { id?: unknown };

/**
 * The id of this exchange. An id already on `req.id` wins (pino-http's `genReqId` and a
 * request-scoped CLS middleware can both call this; whichever runs first decides), then a
 * conforming `X-Request-Id` from the caller, else a fresh UUID. Stored on `req.id` and echoed on
 * the response.
 */
export function resolveRequestId(req: IncomingMessage, res?: ServerResponse): string {
  const request = req as RequestWithId;
  const current = request.id;
  const id =
    typeof current === 'string' && REQUEST_ID_PATTERN.test(current)
      ? current
      : (fromHeader(req) ?? randomUUID());
  request.id = id;
  if (res && !res.headersSent) res.setHeader('X-Request-Id', id);
  return id;
}

function fromHeader(req: IncomingMessage): string | undefined {
  const value = req.headers[REQUEST_ID_HEADER];
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value) ? value : undefined;
}
