import { testDatabaseUrl } from '@tms/db/testing';
import { loadEnv } from '@tms/nest-bootstrap';
import { envSchema } from '../src/env';

describe('api-admin environment', () => {
  it('defaults to port 3001, JSON log files under ./logs and a 1000 ms health budget', () => {
    const DATABASE_URL = testDatabaseUrl();
    expect(loadEnv(envSchema, { DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      LOG_FILE_ENABLED: true,
      LOG_DIR: 'logs',
      LOG_RETENTION_DAYS: 14,
      DATABASE_URL,
      HEALTH_DB_TIMEOUT_MS: 1000,
      PORT: 3001,
      TRUST_PROXY: 'loopback',
      ADMIN_WEB_ORIGINS: ['http://localhost:5173'],
      SESSION_IDLE_MINUTES: 60,
      SESSION_ABSOLUTE_HOURS: 12,
      SESSION_COOKIE_SECURE: true,
    });
  });

  it('rejects a disabled cookie Secure flag in production', () => {
    const DATABASE_URL = testDatabaseUrl();
    expect(() =>
      loadEnv(envSchema, { DATABASE_URL, NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' }),
    ).toThrow(/SESSION_COOKIE_SECURE/);
  });
});
