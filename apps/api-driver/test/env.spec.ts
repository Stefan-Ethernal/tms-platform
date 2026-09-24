import { loadEnv } from '@tms/nest-bootstrap';
import { envSchema } from '../src/app.module';

describe('api-driver environment', () => {
  it('defaults to port 3002 and JSON log files under ./logs', () => {
    expect(loadEnv(envSchema, {})).toEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      LOG_FILE_ENABLED: true,
      LOG_DIR: 'logs',
      LOG_RETENTION_DAYS: 14,
      PORT: 3002,
    });
  });
});
