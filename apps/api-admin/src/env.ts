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
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.SESSION_COOKIE_SECURE, {
    path: ['SESSION_COOKIE_SECURE'],
    message: 'must be true in production',
  });
export type Env = z.infer<typeof envSchema>;
