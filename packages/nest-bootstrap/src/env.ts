import { LOG_LEVELS } from '@tms/logger';
import { z } from 'zod';

/** Unset and empty (`SENTRY_DSN=` in a `.env` file) both mean "not configured". */
const emptyAsUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

/**
 * Variables both APIs read. Later pieces of shared infrastructure (the database connection and its
 * health check, Sentry) add theirs as further entries of this object as they land; an app extends
 * its own schema on top.
 */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Interface to listen on; unset means the NODE_ENV default of listenHost().
  HOST: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  // D14: file logs are on by default; false where the platform collects stdout.
  LOG_FILE_ENABLED: z.stringbool().default(true),
  LOG_DIR: z.string().min(1).default('logs'),
  LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  // Required. The message never echoes the value: it may carry a password.
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    hostname: /^.+$/,
    error: 'must be a postgresql:// URL',
  }),
  // Upper bound of the database ping behind GET /api/health (D5).
  HEALTH_DB_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(1000),
  // Read raw by instrument.ts before this schema runs; validated here so a typo stops the boot.
  SENTRY_DSN: z.preprocess(emptyAsUndefined, z.url({ protocol: /^https?$/ }).optional()),
  SENTRY_ENVIRONMENT: z.preprocess(emptyAsUndefined, z.string().min(1).max(64).optional()),
  SENTRY_RELEASE: z.preprocess(emptyAsUndefined, z.string().min(1).max(200).optional()),
  // Express `trust proxy`: 'false', a hop count or a preset/subnet list (Caddy in compose).
  TRUST_PROXY: z.string().min(1).default('loopback'),
});

/** The schema of one API: the shared variables plus PORT with the app's default. */
export function createEnvSchema({ defaultPort }: { defaultPort: number }) {
  return baseEnvSchema.extend({
    PORT: z.coerce.number().int().min(1).max(65535).default(defaultPort),
  });
}

export type BaseEnv = z.infer<typeof baseEnvSchema> & { PORT: number };

/**
 * The interface an API listens on: HOST when set; otherwise 127.0.0.1 in development (a laptop's
 * API is not reachable from the LAN) and 0.0.0.0 in test and production (a container must accept
 * Caddy's connections). A field default cannot depend on NODE_ENV, hence a function.
 */
export function listenHost(env: Pick<BaseEnv, 'NODE_ENV' | 'HOST'>): string {
  return env.HOST ?? (env.NODE_ENV === 'development' ? '127.0.0.1' : '0.0.0.0');
}

/** Validates the environment before Nest starts; fails fast with every offending variable named. */
export function loadEnv<S extends z.ZodType>(schema: S, source: NodeJS.ProcessEnv): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  return result.data;
}
