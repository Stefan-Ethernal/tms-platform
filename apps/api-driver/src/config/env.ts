import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3002),
});

export type Env = z.infer<typeof EnvSchema>;

/** Validates process.env at startup; fails fast with every offending variable named. */
export function loadEnv(source: NodeJS.ProcessEnv): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  return result.data;
}
