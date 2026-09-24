import { createEnvSchema, loadEnv } from '../../src';

const schema = createEnvSchema({ defaultPort: 3001 });
const required = { DATABASE_URL: 'postgresql://tms:tms@localhost:5432/tms' };
const DSN = 'https://public@o0.ingest.sentry.io/1';

describe('Sentry variables in the env schema', () => {
  it.each([
    ['unset', required],
    ['empty', { ...required, SENTRY_DSN: '', SENTRY_ENVIRONMENT: '', SENTRY_RELEASE: '' }],
  ])('leaves all three undefined when %s', (_label, source) => {
    const env = loadEnv(schema, source);
    expect([env.SENTRY_DSN, env.SENTRY_ENVIRONMENT, env.SENTRY_RELEASE]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('keeps a DSN, an environment and a release', () => {
    const env = loadEnv(schema, {
      ...required,
      SENTRY_DSN: DSN,
      SENTRY_ENVIRONMENT: 'staging',
      SENTRY_RELEASE: '3f2c1ab',
    });
    expect([env.SENTRY_DSN, env.SENTRY_ENVIRONMENT, env.SENTRY_RELEASE]).toEqual([
      DSN,
      'staging',
      '3f2c1ab',
    ]);
  });

  it.each(['not a dsn', 'ftp://public@example.test/1'])(
    'rejects SENTRY_DSN=%s without echoing the value',
    (dsn) => {
      let message = '';
      try {
        loadEnv(schema, { ...required, SENTRY_DSN: dsn });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toBe('Invalid environment: SENTRY_DSN: Invalid URL');
    },
  );

  it('rejects an environment name longer than 64 characters', () => {
    expect(() => loadEnv(schema, { ...required, SENTRY_ENVIRONMENT: 'x'.repeat(65) })).toThrow(
      'Invalid environment: SENTRY_ENVIRONMENT: Too big: expected string to have <=64 characters',
    );
  });
});
