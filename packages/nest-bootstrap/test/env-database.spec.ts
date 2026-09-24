import { createEnvSchema, loadEnv } from '../src';

const schema = createEnvSchema({ defaultPort: 3001 });
const DATABASE_URL = 'postgresql://tms:tms@localhost:5432/tms';
const MESSAGE = 'Invalid environment: DATABASE_URL: must be a postgresql:// URL';

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected loadEnv to throw');
}

describe('DATABASE_URL and HEALTH_DB_TIMEOUT_MS', () => {
  it('requires DATABASE_URL', () => {
    expect(messageOf(() => loadEnv(schema, {}))).toBe(MESSAGE);
  });

  it.each([
    'postgresql://tms:tms@localhost:5432/tms',
    'postgres://tms@db/tms',
    'postgresql://u:p@[::1]:5432/db',
  ])('accepts %s and defaults the health timeout to 1000 ms', (url) => {
    expect(loadEnv(schema, { DATABASE_URL: url })).toMatchObject({
      DATABASE_URL: url,
      HEALTH_DB_TIMEOUT_MS: 1000,
    });
  });

  it.each([
    'mysql://tms:env-secret-pw@db/tms',
    'http://tms:env-secret-pw@db/tms',
    'postgresql:/env-secret-pw',
    'env-secret-pw',
    '',
  ])('rejects %j without echoing the value', (url) => {
    const message = messageOf(() => loadEnv(schema, { DATABASE_URL: url }));
    expect(message).toBe(MESSAGE);
    expect(message).not.toContain('env-secret-pw');
  });

  it('reads HEALTH_DB_TIMEOUT_MS as an integer', () => {
    expect(
      loadEnv(schema, { DATABASE_URL, HEALTH_DB_TIMEOUT_MS: '2500' }).HEALTH_DB_TIMEOUT_MS,
    ).toBe(2500);
  });

  it.each(['99', '10001', 'abc', '1.5'])(
    'rejects HEALTH_DB_TIMEOUT_MS=%s naming the variable',
    (value) => {
      expect(() => loadEnv(schema, { DATABASE_URL, HEALTH_DB_TIMEOUT_MS: value })).toThrow(
        /HEALTH_DB_TIMEOUT_MS/,
      );
    },
  );
});
