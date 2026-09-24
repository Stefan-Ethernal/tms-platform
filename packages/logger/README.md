# @tms/logger

Structured logging for both NestJS APIs (spec section 11, D14). `createLoggerModule({ app, level, file })`
wires nestjs-pino with the redaction rules of `@tms/contracts/security`, request ids (`X-Request-Id`, see
`resolveRequestId`) and, when `file.enabled`, one worker-thread transport writing stdout plus rolling files
`LOG_DIR/<app>/<app>.<yyyy-MM-dd>.<n>.log` (pino-roll, daily, `retentionDays` rotated files kept).
`LoggerShutdown` flushes that transport on `app.close()`; nestjs-pino does not.

Tests override the `LOG_DESTINATION` provider with `MemoryLogStream` from `@tms/logger/testing`. nestjs-pino
keeps one pino-http instance per process, so a test file that boots several apps gives all of them one stream.
