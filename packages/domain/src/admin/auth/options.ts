export interface AdminAuthOptions {
  session: { idleSeconds: number; fullAbsoluteSeconds: number; cookieSecure: boolean };
  invite: { ttlSeconds: number };
  webBaseUrl: string;
  secrets: { keyring: Record<string, Buffer>; activeKeyId: string };
  passwordPepper: Buffer;
  totpIssuer: string;
}
export const AUTH_OPTIONS = 'tms:AdminAuthOptions';
