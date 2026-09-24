import type { IncomingMessage } from 'node:http';
import { hostname } from 'node:os';
import path from 'node:path';
import type { LoggerOptions as PinoOptions } from 'pino';
import type { Options as PinoHttpOptions } from 'pino-http';
import { REDACTED, scrubString } from '@tms/contracts/security';
import { resolveRequestId } from './request-id';
import {
  scrubLogArguments,
  scrubLogFields,
  serializeError,
  serializeRequest,
  serializeResponse,
} from './redaction';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LoggerOptions {
  app: 'api-admin' | 'api-driver';
  level: LogLevel;
  /** D14: LOG_FILE_ENABLED, LOG_DIR, LOG_RETENTION_DAYS. */
  file: { enabled: boolean; dir: string; retentionDays: number };
}

export type FileTransportOptions = {
  file: string;
  frequency: 'daily';
  dateFormat: 'yyyy-MM-dd';
  mkdir: true;
  limit: { count: number; removeOtherLogFiles: true };
};

// The health check path, served under the global API prefix; polled constantly and never auto-logged.
const HEALTH_PATH = '/api/health';

// A second guard behind the req/res serializers, which already scrub or drop every header.
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-device-key"]',
  'res.headers["set-cookie"]',
];

/**
 * The pino half of the options, shared by the HTTP logger and plain pino. Redaction uses the rules
 * of @tms/contracts/security at four points: serializers (req/res/err), formatters (every other
 * field and all child bindings), hooks.logMethod (message and interpolation arguments) and
 * hooks.streamWrite (the finished line, e.g. a msg that pino copied from err.message).
 */
export function buildPinoOptions(options: LoggerOptions): PinoOptions {
  return {
    level: options.level,
    base: { app: options.app, pid: process.pid, hostname: hostname() },
    redact: { paths: [...REDACT_PATHS], censor: REDACTED },
    serializers: { req: serializeRequest, res: serializeResponse, err: serializeError },
    formatters: { log: scrubLogFields, bindings: scrubLogFields },
    hooks: {
      logMethod(args, method) {
        method.apply(this, scrubLogArguments(args));
      },
      streamWrite: scrubString,
    },
  };
}

export function buildPinoHttpOptions(options: LoggerOptions): PinoHttpOptions {
  return {
    ...buildPinoOptions(options),
    // The serializers call pino's standard ones themselves: one shape for pino and pino-http.
    wrapSerializers: false,
    genReqId: resolveRequestId,
    // In-request lines carry only reqId; req/res appear once, on "request completed".
    quietReqLogger: true,
    autoLogging: {
      ignore: (req: IncomingMessage) => (req.url ?? '').split('?')[0] === HEALTH_PATH,
    },
  };
}

/** pino-roll options: LOG_DIR/<app>/<app>.<yyyy-MM-dd>.<n>.log, daily, retentionDays rotated files. */
export function buildFileTransportOptions(options: LoggerOptions): FileTransportOptions {
  return {
    file: path.resolve(options.file.dir, options.app, options.app),
    frequency: 'daily',
    dateFormat: 'yyyy-MM-dd',
    mkdir: true,
    limit: { count: options.file.retentionDays, removeOtherLogFiles: true },
  };
}
