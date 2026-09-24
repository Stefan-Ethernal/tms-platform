import type { ApiName } from '../core.module';

export const HEALTH_OPTIONS = Symbol('HEALTH_OPTIONS');

export interface HealthModuleOptions {
  /** Answered in every body: proves which API an origin reaches (routing identity, journal I7-1). */
  service: ApiName;
  /** HEALTH_DB_TIMEOUT_MS: after this the database counts as down. */
  dbTimeoutMs: number;
}

/** D5 body: the state and the service name, never a database detail. */
export type HealthBody = { status: 'ok' | 'degraded'; service: ApiName };
