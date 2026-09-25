import type { LockoutConfig } from '@tms/auth-core';

export interface AdminAuthOptions {
  session: { idleSeconds: number; fullAbsoluteSeconds: number; cookieSecure: boolean };
  invite: { ttlSeconds: number };
  webBaseUrl: string;
  secrets: { keyring: Record<string, Buffer>; activeKeyId: string };
  passwordPepper: Buffer;
  totpIssuer: string;
  lockout: LockoutConfig;
}
export const AUTH_OPTIONS = 'tms:AdminAuthOptions';
