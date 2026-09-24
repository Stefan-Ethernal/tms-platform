import { type DynamicModule, Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { LoggerModule, type Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import {
  LOG_DESTINATION,
  assertLogDirWritable,
  closeLogDestination,
  createLogDestination,
} from './destination';
import { buildPinoHttpOptions, type LoggerOptions } from './options';

/**
 * Ends the file transport on app.close(), which enableShutdownHooks() also runs on SIGTERM:
 * nestjs-pino has no shutdown hook of its own, so buffered lines would otherwise be lost on exit.
 */
@Injectable()
export class LoggerShutdown implements OnApplicationShutdown {
  constructor(@Inject(LOG_DESTINATION) private readonly destination: DestinationStream) {}

  async onApplicationShutdown(): Promise<void> {
    await closeLogDestination(this.destination);
  }
}

export function createLoggerModule(options: LoggerOptions): DynamicModule {
  // Checked while the module is built, before NestFactory.create: a failing provider factory
  // would take Nest's abort-on-error path instead of surfacing this message.
  if (options.file.enabled) assertLogDirWritable(options);
  return LoggerModule.forRootAsync({
    providers: [
      { provide: LOG_DESTINATION, useFactory: () => createLogDestination(options) },
      LoggerShutdown,
    ],
    inject: [LOG_DESTINATION],
    useFactory: (destination: DestinationStream): Params => ({
      pinoHttp: [buildPinoHttpOptions(options), destination],
    }),
  });
}
