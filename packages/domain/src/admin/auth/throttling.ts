import { createHash } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';
import { AUTH_THROTTLE_KEY } from '@tms/contracts';

export interface AuthThrottleLimits {
  ipLimit: number;
  ipTtlSeconds: number;
  accountLimit: number;
  accountTtlSeconds: number;
}

const isAuthRoute = (ctx: ExecutionContext) =>
  Reflect.getMetadata(AUTH_THROTTLE_KEY, ctx.getHandler()) === true;

/** The account key: normalised email from the body, else the session cookie, else the IP; hashed so it never lands in memory as plain PII. */
export function accountThrottleKey(req: {
  body?: unknown;
  cookies?: Record<string, unknown>;
  ip?: string;
}): string {
  const body = req.body as { email?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : undefined;
  const cookie = Object.entries(req.cookies ?? {}).find(([name]) =>
    name.endsWith('tms_admin_sid'),
  )?.[1];
  const source = email ?? (typeof cookie === 'string' ? cookie : undefined) ?? req.ip ?? 'unknown';
  return createHash('sha256').update(source).digest('hex');
}

/** One bucket per throttler and tracker across all auth routes (the default key is per route). */
const sharedKey = (_ctx: ExecutionContext, tracker: string, name: string) => `${name}:${tracker}`;

export function authThrottlers(l: AuthThrottleLimits): ThrottlerOptions[] {
  const skipIf = (ctx: ExecutionContext): boolean => !isAuthRoute(ctx);
  return [
    {
      name: 'auth-ip',
      ttl: l.ipTtlSeconds * 1000,
      limit: l.ipLimit,
      skipIf,
      getTracker: (req) => String((req as { ip?: string }).ip ?? 'unknown'),
      generateKey: sharedKey,
    },
    {
      name: 'auth-account',
      ttl: l.accountTtlSeconds * 1000,
      limit: l.accountLimit,
      skipIf,
      getTracker: (req) => accountThrottleKey(req as Parameters<typeof accountThrottleKey>[0]),
      generateKey: sharedKey,
    },
  ];
}
