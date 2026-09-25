import { parseKeyring } from '@tms/auth-core';
import { createEnvSchema } from '@tms/nest-bootstrap';
import { z } from 'zod';

const OriginList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url()).min(1));

// Both decode to exactly 32 bytes: 'dev-only-secrets-enc-key-32-byte' and 'dev-only-password-pepper-32bytes'.
export const DEV_KEYRING = 'dev1:ZGV2LW9ubHktc2VjcmV0cy1lbmMta2V5LTMyLWJ5dGU=';
export const DEV_PEPPER = 'ZGV2LW9ubHktcGFzc3dvcmQtcGVwcGVyLTMyYnl0ZXM=';

/** The back-office API's environment: the shared variables, PORT defaulting to 3001, the admin-only variables. */
export const envSchema = createEnvSchema({ defaultPort: 3001 })
  .extend({
    ADMIN_WEB_ORIGINS: OriginList.default(['http://localhost:5173']),
    SESSION_IDLE_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .default(60),
    SESSION_ABSOLUTE_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(7 * 24)
      .default(12),
    SESSION_COOKIE_SECURE: z.stringbool().default(true),
    SMTP_URL: z.url().default('smtp://localhost:1025'),
    MAIL_FROM: z.string().min(3).default('TMS <no-reply@tms.local>'),
    ADMIN_WEB_URL: z.url().default('http://localhost:5173'),
    INVITE_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 14)
      .default(72),
    SECRETS_ENC_KEYS: z.string().default(DEV_KEYRING),
    SECRETS_ENC_ACTIVE_KEY_ID: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,32}$/)
      .default('dev1'),
    PASSWORD_PEPPER: z.string().default(DEV_PEPPER),
    TOTP_ISSUER: z.string().min(1).max(40).default('TMS'),
    LOCKOUT_THRESHOLD: z.coerce.number().int().min(1).max(20).default(5),
    LOCKOUT_BASE_SECONDS: z.coerce.number().int().min(1).max(86400).default(900),
    LOCKOUT_MAX_SECONDS: z.coerce.number().int().min(1).default(3600),
    THROTTLE_AUTH_IP_LIMIT: z.coerce.number().int().min(1).default(30),
    THROTTLE_AUTH_IP_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
    THROTTLE_AUTH_ACCOUNT_LIMIT: z.coerce.number().int().min(1).default(10),
    THROTTLE_AUTH_ACCOUNT_TTL_SECONDS: z.coerce.number().int().min(1).default(900),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.SESSION_COOKIE_SECURE, {
    path: ['SESSION_COOKIE_SECURE'],
    message: 'must be true in production',
  })
  .refine(
    (env) => {
      try {
        const keyring = parseKeyring(env.SECRETS_ENC_KEYS);
        return env.SECRETS_ENC_ACTIVE_KEY_ID in keyring;
      } catch {
        return false;
      }
    },
    {
      path: ['SECRETS_ENC_KEYS'],
      message: 'must be a valid keyring containing SECRETS_ENC_ACTIVE_KEY_ID',
    },
  )
  .refine((env) => Buffer.from(env.PASSWORD_PEPPER, 'base64').length >= 32, {
    path: ['PASSWORD_PEPPER'],
    message: 'must decode to at least 32 bytes',
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.SECRETS_ENC_KEYS !== DEV_KEYRING, {
    path: ['SECRETS_ENC_KEYS'],
    message: 'must not use the development default in production',
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.PASSWORD_PEPPER !== DEV_PEPPER, {
    path: ['PASSWORD_PEPPER'],
    message: 'must not use the development default in production',
  })
  .refine((env) => env.LOCKOUT_MAX_SECONDS >= env.LOCKOUT_BASE_SECONDS, {
    path: ['LOCKOUT_MAX_SECONDS'],
    message: 'must be at least LOCKOUT_BASE_SECONDS',
  });
export type Env = z.infer<typeof envSchema>;
