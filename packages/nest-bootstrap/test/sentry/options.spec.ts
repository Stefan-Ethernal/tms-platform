import type { Breadcrumb, ErrorEvent } from '@sentry/nestjs';
import { buildSentryOptions } from '../../src/sentry';

const DSN = 'https://public@o0.ingest.sentry.io/1';

describe('buildSentryOptions', () => {
  it.each([
    ['unset', {}],
    ['empty', { SENTRY_DSN: '' }],
  ])('is disabled when the DSN is %s', (_label, env) => {
    const options = buildSentryOptions({ app: 'api-admin', env });
    expect(options.enabled).toBe(false);
    expect(options.dsn).toBeUndefined();
  });

  it('is enabled with a DSN', () => {
    const options = buildSentryOptions({ app: 'api-admin', env: { SENTRY_DSN: DSN } });
    expect(options.enabled).toBe(true);
    expect(options.dsn).toBe(DSN);
  });

  it.each([
    [{ SENTRY_ENVIRONMENT: 'staging', NODE_ENV: 'production' }, 'staging'],
    [{ NODE_ENV: 'production' }, 'production'],
    [{ SENTRY_ENVIRONMENT: '', NODE_ENV: 'test' }, 'test'],
    [{}, 'development'],
  ])('derives the environment from %j as %s', (env, expected) => {
    expect(buildSentryOptions({ app: 'api-admin', env }).environment).toBe(expected);
  });

  it.each([
    [{ SENTRY_RELEASE: '3f2c1ab' }, '3f2c1ab'],
    [{ SENTRY_RELEASE: '' }, undefined],
    [{}, undefined],
  ])('takes the release from %j', (env, expected) => {
    expect(buildSentryOptions({ app: 'api-admin', env }).release).toBe(expected);
  });

  it('collects no user data, no bodies, no cookies, no traces and no local variables', () => {
    expect(buildSentryOptions({ app: 'api-admin', env: { SENTRY_DSN: DSN } })).toMatchObject({
      dataCollection: { userInfo: false, cookies: false, httpBodies: [] },
      tracesSampleRate: 0,
      includeLocalVariables: false,
      maxBreadcrumbs: 50,
    });
  });

  it('switches runtime channel injection off under Jest', () => {
    expect(process.env['JEST_WORKER_ID']).toBeDefined();
    expect(buildSentryOptions({ app: 'api-admin', env: {} }).enableRuntimeChannelInjection).toBe(
      false,
    );
  });

  it('drops the user on api-driver and keeps it on api-admin', async () => {
    const event = (): ErrorEvent => ({ type: undefined, user: { id: 'u-1' } });
    const driver = buildSentryOptions({ app: 'api-driver', env: { SENTRY_DSN: DSN } });
    const admin = buildSentryOptions({ app: 'api-admin', env: { SENTRY_DSN: DSN } });
    expect((await driver.beforeSend?.(event(), {}))?.user).toBeUndefined();
    expect((await admin.beforeSend?.(event(), {}))?.user).toEqual({ id: 'u-1' });
  });

  it('scrubs breadcrumbs before they are stored', () => {
    const { beforeBreadcrumb } = buildSentryOptions({ app: 'api-admin', env: { SENTRY_DSN: DSN } });
    const crumb: Breadcrumb = {
      category: 'http',
      message: 'GET /api/x?token=crumb-secret-1',
      data: { headers: { authorization: 'Bearer crumb-secret-2' }, status: 200 },
    };
    const scrubbed = beforeBreadcrumb?.(crumb, {});
    expect(scrubbed).toEqual({
      category: 'http',
      message: 'GET /api/x?token=[REDACTED]',
      data: { headers: { authorization: '[REDACTED]' }, status: 200 },
    });
  });
});
