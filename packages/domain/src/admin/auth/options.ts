export interface AdminAuthOptions {
  session: { idleSeconds: number; fullAbsoluteSeconds: number; cookieSecure: boolean };
}
export const AUTH_OPTIONS = 'tms:AdminAuthOptions';
