import { testDatabaseUrl } from '@tms/db/testing';
import { loadEnv } from '@tms/nest-bootstrap';
import { DEV_KEYRING, DEV_PEPPER, envSchema } from '../src/env';

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
      SMTP_URL: 'smtp://localhost:1025',
      MAIL_FROM: 'TMS <no-reply@tms.local>',
      ADMIN_WEB_URL: 'http://localhost:5173',
      INVITE_TTL_HOURS: 72,
      SECRETS_ENC_KEYS: DEV_KEYRING,
      SECRETS_ENC_ACTIVE_KEY_ID: 'dev1',
      PASSWORD_PEPPER: DEV_PEPPER,
      TOTP_ISSUER: 'TMS',
      LOCKOUT_THRESHOLD: 5,
      LOCKOUT_BASE_SECONDS: 900,
      LOCKOUT_MAX_SECONDS: 3600,
      THROTTLE_AUTH_IP_LIMIT: 30,
      THROTTLE_AUTH_IP_TTL_SECONDS: 60,
      THROTTLE_AUTH_ACCOUNT_LIMIT: 10,
      THROTTLE_AUTH_ACCOUNT_TTL_SECONDS: 900,
    });
  });

  it('rejects a lockout cap lower than the base duration', () => {
    const DATABASE_URL = testDatabaseUrl();
    expect(() =>
      loadEnv(envSchema, {
        DATABASE_URL,
        LOCKOUT_BASE_SECONDS: '900',
        LOCKOUT_MAX_SECONDS: '60',
      }),
    ).toThrow(/LOCKOUT_MAX_SECONDS/);
  });

  it('rejects a disabled cookie Secure flag in production', () => {
    const DATABASE_URL = testDatabaseUrl();
    expect(() =>
      loadEnv(envSchema, { DATABASE_URL, NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' }),
    ).toThrow(/SESSION_COOKIE_SECURE/);
  });

  it('both dev defaults decode to exactly 32 bytes', () => {
    expect(Buffer.from(DEV_PEPPER, 'base64').length).toBe(32);
    expect(Buffer.from(DEV_KEYRING.split(':')[1]!, 'base64').length).toBe(32);
  });

  it('rejects a keyring that does not contain the active key id, without echoing either value', () => {
    const DATABASE_URL = testDatabaseUrl();
    expect(() =>
      loadEnv(envSchema, {
        DATABASE_URL,
        SECRETS_ENC_KEYS: DEV_KEYRING,
        SECRETS_ENC_ACTIVE_KEY_ID: 'missing',
      }),
    ).toThrow(/SECRETS_ENC_KEYS/);
  });

  it('rejects an undersized password pepper', () => {
    const DATABASE_URL = testDatabaseUrl();
    const short = Buffer.from('too-short').toString('base64');
    expect(() => loadEnv(envSchema, { DATABASE_URL, PASSWORD_PEPPER: short })).toThrow(
      /PASSWORD_PEPPER/,
    );
  });

  it('rejects the dev keyring and pepper in production, without echoing either value', () => {
    const DATABASE_URL = testDatabaseUrl();
    expect(() => {
      try {
        loadEnv(envSchema, { DATABASE_URL, NODE_ENV: 'production' });
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toMatch(/SECRETS_ENC_KEYS/);
        expect(message).not.toContain(DEV_KEYRING);
        expect(message).not.toContain(DEV_PEPPER);
        throw error;
      }
    }).toThrow();
  });
});
