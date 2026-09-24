import * as Sentry from '@sentry/nestjs';
import type { NodeOptions } from '@sentry/nestjs';
import { scrubDeep } from '@tms/contracts/security';
import { type SentryApp, scrubSentryEvent } from './scrub';

/** The variables Sentry reads. `instrument.ts` passes `process.env` itself (see there why). */
export interface SentryEnv {
  readonly SENTRY_DSN?: string | undefined;
  readonly SENTRY_ENVIRONMENT?: string | undefined;
  readonly SENTRY_RELEASE?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

export interface SentryOptionsInput {
  readonly app: SentryApp;
  readonly env: SentryEnv;
}

/** An empty string (`SENTRY_DSN=` in a `.env` file) means "not set", as in the env schema. */
function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

export function buildSentryOptions({ app, env }: SentryOptionsInput): NodeOptions {
  const dsn = nonEmpty(env.SENTRY_DSN);
  return {
    dsn,
    enabled: dsn !== undefined,
    environment: nonEmpty(env.SENTRY_ENVIRONMENT) ?? nonEmpty(env.NODE_ENV) ?? 'development',
    release: nonEmpty(env.SENTRY_RELEASE),
    // Sentry 11 replaced `sendDefaultPii` with `dataCollection`, whose defaults collect the user's
    // IP, cookies, headers and bodies. Headers stay collected so beforeSend can scrub them.
    dataCollection: { userInfo: false, cookies: false, httpBodies: [] },
    tracesSampleRate: 0,
    includeLocalVariables: false,
    maxBreadcrumbs: 50,
    // Jest 30 throws on module.registerHooks(); without this every init inside a test warns.
    enableRuntimeChannelInjection: process.env['JEST_WORKER_ID'] === undefined,
    beforeSend: (event) => scrubSentryEvent(event, { app }),
    beforeBreadcrumb: (breadcrumb) => scrubDeep(breadcrumb),
  };
}

/**
 * Calls `Sentry.init` only when a DSN is configured. Without one nothing is initialised: no client,
 * no process listeners, no module hooks, so `import './instrument'` has no side effects.
 */
export function initSentry(options: NodeOptions): void {
  if (options.enabled === true) Sentry.init(options);
}
