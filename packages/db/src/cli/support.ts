import { existsSync } from 'node:fs';
import { EmailSchema } from '@tms/contracts';
import { scrubString } from '@tms/contracts/security';

export const EXIT_FAILURE = 1;
export const EXIT_CONFIG = 2;

/** Loads `./.env` when present. Node never overrides variables already set in the environment. */
export function loadDotEnv(): void {
  if (existsSync('.env')) process.loadEnvFile('.env');
}

export function requireDatabaseUrl(
  env: NodeJS.ProcessEnv,
  stderr: NodeJS.WritableStream,
): string | undefined {
  const url = env['DATABASE_URL'];
  if (!url) {
    stderr.write('DATABASE_URL is not set\n');
    return undefined;
  }
  return url;
}

/** One JSON line per event on stdout: machine-readable for CI, grep-able for humans. */
export function printEvent(event: string, payload: object): void {
  process.stdout.write(`${JSON.stringify({ event, ...payload })}\n`);
}

/** `<prefix>: <ErrorName>: <message>` with URL credentials, tokens and passwords scrubbed. */
export function describeFailure(prefix: string, error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  return `${prefix}: ${name}: ${scrubString(message)}`;
}

export const DRIFT_HINT =
  'Schema has changes without a migration. Create one with: pnpm turbo run db:migrate:dev --filter=@tms/db -- --name <change>';

/** Validated bootstrap-admin settings, or undefined after the reason was written to stderr. */
export function readBootstrapAdmin(
  env: NodeJS.ProcessEnv,
  stderr: NodeJS.WritableStream,
): { email: string | undefined; username?: string } | undefined {
  const username = env['BOOTSTRAP_ADMIN_USERNAME'] || undefined;
  const raw = env['BOOTSTRAP_ADMIN_EMAIL'];
  if (!raw) return { email: undefined, username };
  const parsed = EmailSchema.safeParse(raw);
  if (!parsed.success) {
    stderr.write('BOOTSTRAP_ADMIN_EMAIL is not a valid email address\n');
    return undefined;
  }
  return { email: parsed.data, username };
}
