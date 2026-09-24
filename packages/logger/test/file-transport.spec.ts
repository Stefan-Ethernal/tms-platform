import { once } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import pino from 'pino';
import {
  buildFileTransportOptions,
  buildPinoOptions,
  closeLogDestination,
  createLogDestination,
  createLoggerModule,
  type LoggerOptions,
} from '../src';

type Transport = ReturnType<typeof pino.transport>;

const SECRET = 'file-secret-3141';
const FILE_NAME = /^api-admin\.\d{4}-\d{2}-\d{2}\.\d+\.log$/;
const itUnlessRoot = process.getuid?.() === 0 ? it.skip : it;

const tempDir = (): string => mkdtempSync(path.join(tmpdir(), 'tms-logger-'));
const options = (dir: string, file: Partial<LoggerOptions['file']> = {}): LoggerOptions => ({
  app: 'api-admin',
  level: 'info',
  file: { enabled: true, dir, retentionDays: 3, ...file },
});
const readAll = (dir: string): string =>
  readdirSync(dir)
    .map((file) => readFileSync(path.join(dir, file), 'utf8'))
    .join('');

/** pino-roll alone (no stdout target) with a test-only size limit that forces rotation. */
function rollTransport(opts: LoggerOptions): Transport {
  return pino.transport({
    targets: [
      {
        target: require.resolve('pino-roll'),
        options: { ...buildFileTransportOptions(opts), size: '1k' },
      },
    ],
  });
}

async function end(transport: Transport): Promise<void> {
  const closed = once(transport, 'close');
  transport.end();
  await closed;
}

// Padded well past the 1 KB roll threshold on its own: whatever the worker's ring buffer happens to
// coalesce a write into (one line or several — see logUntilRolled below), that single write's byte
// count already crosses the limit. Rotation no longer depends on the OS/pipe layer ever delivering
// more than one chunk.
const OVERSIZED_PADDING = 'x'.repeat(1200);
const forceRollLine = (i: number): string =>
  `line ${i} Bearer ${SECRET} padding to reach the size limit ${OVERSIZED_PADDING}`;

/**
 * Logs oversized lines and polls `dir` until `predicate` holds, or `timeoutMs` elapses — and must
 * run to completion *before* the transport is ended. Installed-source facts (not assumptions):
 * pino-roll's size-triggered roll (`pino-roll.js`) only fires once the worker-thread destination
 * emits a 'drain' event (`destination.once('drain', () => roll())`); SonicBoom.prototype.end()
 * (`sonic-boom/index.js`) sets an internal `_ending` flag as the very first thing it does, and once
 * `_ending` is true, `release()`'s branch that emits 'drain' (`else { ...; this.emit('drain') }`)
 * becomes permanently unreachable for the rest of that destination's life — it only reaches the
 * `_ending` branch instead, which flushes remaining bytes and closes, but never emits 'drain'. So a
 * roll still waiting on 'drain' when `end(transport)` runs is not delayed, it is lost forever: no
 * amount of waiting *after* `end()` can make it happen (this is what round 1's `waitForDir`-after-
 * `end()` got wrong). Polling before `end()`, and continuing to log while unmet, keeps producing
 * fresh 'write'/'drain' opportunities until the roll (and, for the retention test, its synchronous-
 * within-`roll()` cleanup) has actually completed on disk.
 */
async function logUntilRolled(
  logger: pino.Logger,
  dir: string,
  predicate: (files: string[]) => boolean,
  {
    timeoutMs = 8000,
    batchSize = 3,
    intervalMs = 20,
  }: {
    timeoutMs?: number;
    batchSize?: number;
    intervalMs?: number;
  } = {},
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  let i = 0;
  for (;;) {
    for (let b = 0; b < batchSize; b += 1, i += 1) {
      logger.info({ i, password: SECRET }, forceRollLine(i));
    }
    await sleep(intervalMs);
    const files = existsSync(dir) ? readdirSync(dir) : [];
    if (predicate(files)) return files;
    if (Date.now() > deadline) return files;
  }
}

describe('file transport', () => {
  it('rolls into <app>.<yyyy-MM-dd>.<n>.log files, within the retention limit, without secrets', async () => {
    const opts = options(tempDir());
    const transport = rollTransport(opts);
    const logger = pino(buildPinoOptions(opts), transport);
    const appDir = path.join(opts.file.dir, 'api-admin');
    const files = await logUntilRolled(
      logger,
      appDir,
      (candidates) => candidates.length >= 2 && candidates.length <= opts.file.retentionDays + 1,
    );
    await end(transport);
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.length).toBeLessThanOrEqual(opts.file.retentionDays + 1);
    expect(files.every((file) => FILE_NAME.test(file))).toBe(true);
    const content = readAll(appDir);
    expect(content).toContain('Bearer [REDACTED] padding');
    expect(content).toContain('"password":"[REDACTED]"');
    expect(content).not.toContain(SECRET);
  }, 20_000);

  it("retention deletes this application's old files and never the other application's", async () => {
    const dir = tempDir();
    const oldDays = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'];
    for (const app of ['api-admin', 'api-driver']) {
      mkdirSync(path.join(dir, app));
      for (const day of oldDays) {
        writeFileSync(path.join(dir, app, `${app}.${day}.1.log`), `{"old":"${app} ${day}"}\n`);
      }
    }
    const driverBefore = readdirSync(path.join(dir, 'api-driver')).sort();
    const opts = options(dir, { retentionDays: 1 });
    const transport = rollTransport(opts);
    const logger = pino(buildPinoOptions(opts), transport);
    const adminFiles = await logUntilRolled(
      logger,
      path.join(dir, 'api-admin'),
      (candidates) => candidates.filter((file) => file.includes('.2026-01-')).length === 0,
    );
    await end(transport);
    expect(adminFiles.filter((file) => file.includes('.2026-01-'))).toEqual([]);
    expect(readdirSync(path.join(dir, 'api-driver')).sort()).toEqual(driverBefore);
    expect(readAll(path.join(dir, 'api-driver'))).toContain('"old":"api-driver 2026-01-04"');
  }, 20_000);

  it('createLogDestination writes LOG_DIR/<app>/ (and stdout) and closeLogDestination flushes it', async () => {
    const opts = options(tempDir());
    const destination = createLogDestination(opts);
    pino(buildPinoOptions(opts), destination).info({ password: SECRET }, 'destination probe');
    await closeLogDestination(destination);
    await closeLogDestination(destination);
    const appDir = path.join(opts.file.dir, 'api-admin');
    const files = readdirSync(appDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^api-admin\.\d{4}-\d{2}-\d{2}\.1\.log$/);
    const content = readAll(appDir);
    expect(content).toContain('"msg":"destination probe"');
    expect(content).toContain('"password":"[REDACTED]"');
    expect(content).not.toContain(SECRET);
  });

  it('with file logging disabled uses process.stdout, creates no directory and never ends stdout', async () => {
    const dir = path.join(tempDir(), 'never-created');
    const opts = options(dir, { enabled: false });
    createLoggerModule(opts);
    const destination = createLogDestination(opts);
    expect(destination).toBe(process.stdout);
    await closeLogDestination(destination);
    expect(process.stdout.writableEnded).toBe(false);
    expect(existsSync(dir)).toBe(false);
  });

  itUnlessRoot(
    'fails while the module is built, naming LOG_DIR, when the directory is not writable',
    () => {
      const dir = tempDir();
      chmodSync(dir, 0o500);
      try {
        expect(() => createLoggerModule(options(dir))).toThrow(`LOG_DIR is not writable: ${dir}`);
        expect(() => createLogDestination(options(dir))).toThrow(`LOG_DIR is not writable: ${dir}`);
      } finally {
        chmodSync(dir, 0o700);
      }
    },
  );
});
