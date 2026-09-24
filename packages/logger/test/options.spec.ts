import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { scrubString } from '@tms/contracts/security';
import {
  buildFileTransportOptions,
  buildPinoHttpOptions,
  type LoggerOptions,
} from '../src/options';
import { resolveRequestId } from '../src/request-id';

const OPTIONS: LoggerOptions = {
  app: 'api-driver',
  level: 'debug',
  file: { enabled: true, dir: '/var/log/tms', retentionDays: 14 },
};

describe('buildPinoHttpOptions', () => {
  it('sets level, header redaction, request ids, the quiet request logger and the app binding', () => {
    const options = buildPinoHttpOptions(OPTIONS);
    expect(options.level).toBe('debug');
    expect(options.redact).toEqual({
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-device-key"]',
        'res.headers["set-cookie"]',
      ],
      censor: '[REDACTED]',
    });
    expect(options.genReqId).toBe(resolveRequestId);
    expect(options.quietReqLogger).toBe(true);
    expect(options.wrapSerializers).toBe(false);
    expect(Object.keys(options.serializers ?? {}).sort()).toEqual(['err', 'req', 'res']);
    expect(options.base).toMatchObject({ app: 'api-driver', pid: process.pid });
    // Inherited from buildPinoOptions: the message pass and the finished-line pass.
    expect(options.hooks?.streamWrite).toBe(scrubString);
    expect(typeof options.hooks?.logMethod).toBe('function');
  });

  it.each([
    ['/api/health', true],
    ['/api/health?probe=1', true],
    ['/api/healthz', false],
    ['/api/echo', false],
    [undefined, false],
  ])('autoLogging.ignore(%s) is %s', (url, ignored) => {
    const { autoLogging } = buildPinoHttpOptions(OPTIONS);
    const ignore = typeof autoLogging === 'object' ? autoLogging.ignore : undefined;
    expect(ignore?.({ url } as unknown as IncomingMessage)).toBe(ignored);
  });

  it('returns fresh objects on every call (pino-http mutates the options it receives)', () => {
    const first = buildPinoHttpOptions(OPTIONS);
    const second = buildPinoHttpOptions(OPTIONS);
    expect(second).not.toBe(first);
    expect(second.autoLogging).not.toBe(first.autoLogging);
    expect(second.serializers).not.toBe(first.serializers);
  });
});

describe('buildFileTransportOptions', () => {
  it('writes LOG_DIR/<app>/<app>.<yyyy-MM-dd>.<n>.log daily, keeps retentionDays files, no symlink', () => {
    expect(buildFileTransportOptions(OPTIONS)).toEqual({
      file: '/var/log/tms/api-driver/api-driver',
      frequency: 'daily',
      dateFormat: 'yyyy-MM-dd',
      mkdir: true,
      limit: { count: 14, removeOtherLogFiles: true },
    });
  });

  it('resolves a relative LOG_DIR against the working directory', () => {
    const relative: LoggerOptions = { ...OPTIONS, file: { ...OPTIONS.file, dir: 'logs' } };
    expect(buildFileTransportOptions(relative).file).toBe(
      path.resolve('logs', 'api-driver', 'api-driver'),
    );
  });
});
