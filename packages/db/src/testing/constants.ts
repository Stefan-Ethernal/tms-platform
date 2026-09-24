/** Same image as the compose `postgres` service (a test keeps the two equal). */
export const POSTGRES_TEST_IMAGE = 'postgres:18-alpine';

export const TEMPLATE_DB = 'tms_template';
export const WORKER_DB_PREFIX = 'tms_w';
/** Stands for the Jest worker id; `{n}` would not survive URL encoding (`URL` escapes braces). */
export const WORKER_PLACEHOLDER = '__N__';

/** Environment set by globalSetup and inherited by every Jest worker. */
export const HARNESS_ENV = {
  adminUrl: 'TEST_DB_ADMIN_URL',
  urlTemplate: 'TEST_DB_URL_TEMPLATE',
  workerCount: 'TEST_DB_WORKER_COUNT',
} as const;
