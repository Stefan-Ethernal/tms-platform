import type { IncomingMessage } from 'node:http';

/** Per-request data kept in the CLS store by `SharedModule`'s middleware. */
export interface RequestContext {
  readonly requestId: string;
  readonly ip?: string | undefined;
  readonly userAgent?: string | undefined;
}

export const REQUEST_CONTEXT_KEY = 'tms:request-context';

/** Longer user agents are truncated; the column is free text and the value is attacker-controlled. */
export const USER_AGENT_MAX_LENGTH = 512;

/** Express adds `ip`; plain Node requests only have the socket address. */
export type IncomingRequest = IncomingMessage & { ip?: string | undefined };

export function requestContextFrom(requestId: string, req: IncomingRequest): RequestContext {
  const userAgent = req.headers['user-agent'];
  return {
    requestId,
    ip: req.ip ?? req.socket.remoteAddress,
    userAgent:
      typeof userAgent === 'string' ? userAgent.slice(0, USER_AGENT_MAX_LENGTH) : undefined,
  };
}
