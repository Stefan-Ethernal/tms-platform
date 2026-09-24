import { LOG_LEVELS } from '@tms/logger';
import { z } from 'zod';
import { createEnvSchema, listenHost, loadEnv } from '../src/env';

const adminSchema = createEnvSchema({ defaultPort: 3001 });

const DEFAULTS = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  LOG_FILE_ENABLED: true,
  LOG_DIR: 'logs',
  LOG_RETENTION_DAYS: 14,
  PORT: 3001,
};

/** loadEnv's error: every offending variable, in schema order, joined with '; '. */
const invalid = (details: string): Error => new Error(`Invalid environment: ${details}`);

describe('loadEnv(createEnvSchema(...))', () => {
  it('applies every default', () => {
    expect(loadEnv(adminSchema, {})).toEqual(DEFAULTS);
  });

  it('takes the default port from the app', () => {
    expect(loadEnv(createEnvSchema({ defaultPort: 3002 }), {})).toEqual({
      ...DEFAULTS,
      PORT: 3002,
    });
  });

  it('coerces PORT from a string', () => {
    expect(loadEnv(adminSchema, { PORT: '3005' }).PORT).toBe(3005);
  });

  it.each<[string, string]>([
    ['abc', 'Invalid input: expected number, received NaN'],
    ['0', 'Too small: expected number to be >=1'],
    ['70000', 'Too big: expected number to be <=65535'],
    ['-1', 'Too small: expected number to be >=1'],
    ['3001.5', 'Invalid input: expected int, received number'],
  ])('rejects PORT=%s naming the variable', (port, message) => {
    expect(() => loadEnv(adminSchema, { PORT: port })).toThrow(invalid(`PORT: ${message}`));
  });

  it.each(['development', 'test', 'production'])('accepts NODE_ENV=%s', (nodeEnv) => {
    expect(loadEnv(adminSchema, { NODE_ENV: nodeEnv }).NODE_ENV).toBe(nodeEnv);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadEnv(adminSchema, { NODE_ENV: 'staging' })).toThrow(
      invalid('NODE_ENV: Invalid option: expected one of "development"|"test"|"production"'),
    );
  });

  it.each(LOG_LEVELS)('accepts LOG_LEVEL=%s', (level) => {
    expect(loadEnv(adminSchema, { LOG_LEVEL: level }).LOG_LEVEL).toBe(level);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(() => loadEnv(adminSchema, { LOG_LEVEL: 'verbose' })).toThrow(
      invalid(
        'LOG_LEVEL: Invalid option: expected one of "fatal"|"error"|"warn"|"info"|"debug"|"trace"|"silent"',
      ),
    );
  });

  it.each<[string, boolean]>([
    ['true', true],
    ['false', false],
    ['1', true],
    ['0', false],
    ['FALSE', false],
  ])('reads LOG_FILE_ENABLED=%s as %s', (raw, expected) => {
    expect(loadEnv(adminSchema, { LOG_FILE_ENABLED: raw }).LOG_FILE_ENABLED).toBe(expected);
  });

  it('rejects a LOG_FILE_ENABLED that is not a boolean word, naming it', () => {
    expect(() => loadEnv(adminSchema, { LOG_FILE_ENABLED: 'maybe' })).toThrow(
      invalid(
        'LOG_FILE_ENABLED: Invalid option: expected one of "true"|"1"|"yes"|"on"|"y"|"enabled"|"false"|"0"|"no"|"off"|"n"|"disabled"',
      ),
    );
  });

  it('coerces LOG_RETENTION_DAYS', () => {
    expect(loadEnv(adminSchema, { LOG_RETENTION_DAYS: '7' }).LOG_RETENTION_DAYS).toBe(7);
  });

  it.each<[string, string]>([
    ['0', 'Too small: expected number to be >=1'],
    ['366', 'Too big: expected number to be <=365'],
  ])('rejects LOG_RETENTION_DAYS=%s', (days, message) => {
    expect(() => loadEnv(adminSchema, { LOG_RETENTION_DAYS: days })).toThrow(
      invalid(`LOG_RETENTION_DAYS: ${message}`),
    );
  });

  it('rejects an empty LOG_DIR', () => {
    expect(() => loadEnv(adminSchema, { LOG_DIR: '' })).toThrow(
      invalid('LOG_DIR: Too small: expected string to have >=1 characters'),
    );
  });

  it.each<[string, string]>([
    ['development', '127.0.0.1'],
    ['test', '0.0.0.0'],
    ['production', '0.0.0.0'],
  ])('listens on the NODE_ENV=%s default %s while HOST is unset', (nodeEnv, host) => {
    expect(listenHost(loadEnv(adminSchema, { NODE_ENV: nodeEnv }))).toBe(host);
  });

  it('lets an explicit HOST win over the default', () => {
    expect(listenHost(loadEnv(adminSchema, { NODE_ENV: 'production', HOST: '10.0.0.5' }))).toBe(
      '10.0.0.5',
    );
    expect(listenHost(loadEnv(adminSchema, { HOST: '0.0.0.0' }))).toBe('0.0.0.0');
  });

  it('rejects an empty HOST', () => {
    expect(() => loadEnv(adminSchema, { HOST: '' })).toThrow(
      invalid('HOST: Too small: expected string to have >=1 characters'),
    );
  });

  it('names every offending variable in one message', () => {
    expect(() => loadEnv(adminSchema, { PORT: 'abc', NODE_ENV: 'staging' })).toThrow(
      invalid(
        'NODE_ENV: Invalid option: expected one of "development"|"test"|"production"; PORT: Invalid input: expected number, received NaN',
      ),
    );
  });

  it('ignores unrelated variables', () => {
    expect(loadEnv(adminSchema, { HOME: '/home/x', PATH: '/bin' })).toEqual(DEFAULTS);
  });

  it('validates the variables an app adds with .extend()', () => {
    const extended = adminSchema.extend({ EXTRA_URL: z.string().min(1) });
    expect(loadEnv(extended, { EXTRA_URL: 'x' })).toEqual({ ...DEFAULTS, EXTRA_URL: 'x' });
    expect(() => loadEnv(extended, {})).toThrow(
      invalid('EXTRA_URL: Invalid input: expected string, received undefined'),
    );
  });
});
