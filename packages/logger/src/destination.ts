import { once } from 'node:events';
import { accessSync, constants, mkdirSync } from 'node:fs';
import path from 'node:path';
import pino, { type DestinationStream } from 'pino';
import { buildFileTransportOptions, type LoggerOptions } from './options';

/** DI token of the pino destination; tests override it with a MemoryLogStream. */
export const LOG_DESTINATION = Symbol('LOG_DESTINATION');

type LogTransport = ReturnType<typeof pino.transport>;

// Only transports created here are ended on shutdown; an injected test stream belongs to its test.
const ownedTransports = new WeakSet<object>();

/** Creates LOG_DIR/<app> if needed and fails with a message naming LOG_DIR unless it is writable. */
export function assertLogDirWritable(options: LoggerOptions): void {
  const appDir = path.resolve(options.file.dir, options.app);
  try {
    mkdirSync(appDir, { recursive: true });
    accessSync(appDir, constants.W_OK);
  } catch (cause) {
    throw new Error(`LOG_DIR is not writable: ${options.file.dir}`, { cause });
  }
}

/**
 * process.stdout when file logging is off (D14: LOG_FILE_ENABLED=false); otherwise one worker
 * thread writing every line to stdout (fd 1) and to pino-roll under LOG_DIR/<app>/.
 */
export function createLogDestination(options: LoggerOptions): DestinationStream {
  if (!options.file.enabled) return process.stdout;
  assertLogDirWritable(options);
  // Worker targets default to level info; 'silent' reaches no target, so any level works for it.
  const level = options.level === 'silent' ? 'fatal' : options.level;
  // Explicit type argument: otherwise TypeScript infers the first target's options for both.
  const transport = pino.transport<Record<string, unknown>>({
    targets: [
      { target: 'pino/file', level, options: { destination: 1 } },
      // Absolute path: pino resolves a bare target relative to the file that calls pino.transport.
      { target: require.resolve('pino-roll'), level, options: buildFileTransportOptions(options) },
    ],
  });
  ownedTransports.add(transport);
  return transport;
}

/** Flushes and closes a transport created by createLogDestination; anything else is left alone. */
export async function closeLogDestination(destination: DestinationStream): Promise<void> {
  if (!ownedTransports.has(destination)) return;
  ownedTransports.delete(destination);
  const transport = destination as LogTransport;
  // A line logged by a later shutdown hook reaches an ended worker; it must not crash the exit.
  transport.on('error', () => undefined);
  const closed = once(transport, 'close');
  transport.end();
  await closed;
}
