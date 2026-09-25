import { DEFAULT_LOCKOUT_CONFIG } from '@tms/auth-core';
import type { AdminAuthOptions } from '../../../src/admin';

/**
 * `AdminAuthOptions` for domain-level Nest testing modules (`AdminAuthModule.forRoot`), outside
 * any api-admin `Env`. Tasks 18 and 22 add `passwordReset` and `mfaReset` here when they extend
 * `AdminAuthOptions`.
 */
export const testAuthOptions: AdminAuthOptions = {
  session: { idleSeconds: 3600, fullAbsoluteSeconds: 12 * 3600, cookieSecure: true },
  invite: { ttlSeconds: 72 * 3600 },
  webBaseUrl: 'http://localhost:5173',
  secrets: { keyring: { dev1: Buffer.alloc(32, 1) }, activeKeyId: 'dev1' },
  passwordPepper: Buffer.alloc(32, 2),
  totpIssuer: 'TMS',
  lockout: DEFAULT_LOCKOUT_CONFIG,
};
