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

// pino-roll counts bytes per chunk the worker receives: a synchronous burst arrives as one chunk and
// never rolls, so lines go out in spaced batches; the final pause lets cleanup finish.
async function logInBatches(logger: pino.Logger, lines: number): Promise<void> {
  for (let i = 0; i < lines; i += 1) {
    logger.info(
      { i, password: SECRET },
      `line ${i} Bearer ${SECRET} padding to reach the size limit`,
    );
    if (i % 5 === 4) await sleep(40);
  }
  await sleep(200);
}

async function end(transport: Transport): Promise<void> {
  const closed = once(transport, 'close');
  transport.end();
  await closed;
}

// pino-roll's size-triggered roll waits for a 'drain' event inside the worker thread, and its
// retention cleanup (removeOldFiles) runs as a fire-and-forget promise that the roll callback never
// awaits — neither is signalled back to this (main) thread, and `end(transport)`'s 'close' event
// guarantees only that the file descriptor finished closing, not that a pending roll or cleanup had
// already run. A fixed sleep tuned to one machine's I/O speed is not a reliable way to wait for that
// worker-thread async work, so poll the directory for the expected end-state instead, generously
// bounded so a slower CI runner still gets there.
async function waitForDir(
  dir: string,
  predicate: (files: string[]) => boolean,
  { timeoutMs = 5000, intervalMs = 25 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const files = existsSync(dir) ? readdirSync(dir) : [];
    if (predicate(files)) return files;
    if (Date.now() > deadline) return files;
    await sleep(intervalMs);
  }
}

describe('file transport', () => {
  it('rolls into <app>.<yyyy-MM-dd>.<n>.log files, within the retention limit, without secrets', async () => {
    const opts = options(tempDir());
    const transport = rollTransport(opts);
    await logInBatches(pino(buildPinoOptions(opts), transport), 30);
    await end(transport);
    const appDir = path.join(opts.file.dir, 'api-admin');
    const files = await waitForDir(
      appDir,
      (candidates) => candidates.length >= 2 && candidates.length <= opts.file.retentionDays + 1,
    );
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
    await logInBatches(pino(buildPinoOptions(opts), transport), 20);
    await end(transport);
    const adminFiles = await waitForDir(
      path.join(dir, 'api-admin'),
      (candidates) => candidates.filter((file) => file.includes('.2026-01-')).length === 0,
    );
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
