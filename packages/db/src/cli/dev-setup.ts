#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { scrubString } from '@tms/contracts/security';
import { createPrismaClient } from '../index';
import { SeedConfigError, seedDatabase } from '../seed/seed';
import { syncPermissions } from '../sync/apply';
import {
  describeFailure,
  DRIFT_HINT,
  EXIT_CONFIG,
  EXIT_FAILURE,
  loadDotEnv,
  printEvent,
  readBootstrapAdmin,
  requireDatabaseUrl,
} from './support';

// dist/cli -> package root. Prisma gets explicit paths, so the caller's cwd does not matter.
const PACKAGE_ROOT = resolve(__dirname, '..', '..');
const PRISMA_CONFIG = resolve(PACKAGE_ROOT, 'prisma.config.ts');
const SCHEMA = resolve(PACKAGE_ROOT, 'prisma', 'schema.prisma');
const PRISMA_CLI = require.resolve('prisma/build/index.js');

/**
 * Runs the Prisma CLI and returns its exit code. Output is captured (never `stdio: 'inherit'`)
 * and scrubbed before it reaches our own stdout/stderr: the child can embed the datasource URL
 * (with credentials) in its own error or debug output (e.g. under `DEBUG=prisma:*`), which would
 * otherwise bypass `describeFailure`/`scrubString` entirely.
 */
function prisma(args: string[]): number {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args, '--config', PRISMA_CONFIG], {
    encoding: 'utf8',
    // No update-check network call from a pipeline step.
    env: { ...process.env, CHECKPOINT_DISABLE: '1' },
  });
  if (result.error) throw result.error;
  const stdout = scrubString(result.stdout ?? '');
  const stderr = scrubString(result.stderr ?? '');
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  return result.status ?? EXIT_FAILURE;
}

async function main(): Promise<number> {
  loadDotEnv();
  const url = requireDatabaseUrl(process.env, process.stderr);
  if (!url) return EXIT_CONFIG;
  const bootstrapAdmin = readBootstrapAdmin(process.env, process.stderr);
  if (!bootstrapAdmin) return EXIT_CONFIG;

  const deploy = prisma(['migrate', 'deploy']);
  if (deploy !== 0) {
    process.stderr.write(`prisma migrate deploy failed (exit ${deploy})\n`);
    return EXIT_FAILURE;
  }

  // 0 = in sync, 2 = the schema has changes no migration describes, 1 = error.
  const drift = prisma([
    'migrate',
    'diff',
    '--from-config-datasource',
    '--to-schema',
    SCHEMA,
    '--exit-code',
  ]);
  if (drift === 2) {
    process.stderr.write(`${DRIFT_HINT}\n`);
    return EXIT_CONFIG;
  }
  if (drift !== 0) {
    process.stderr.write(`prisma migrate diff failed (exit ${drift})\n`);
    return EXIT_FAILURE;
  }

  const client = createPrismaClient({ url });
  try {
    printEvent('permissions.synced', await syncPermissions(client));
    printEvent('seed.applied', await seedDatabase(client, { bootstrapAdmin }));
    return 0;
  } catch (error) {
    process.stderr.write(`${describeFailure('dev setup failed', error)}\n`);
    return error instanceof SeedConfigError ? EXIT_CONFIG : EXIT_FAILURE;
  } finally {
    await client.$disconnect();
  }
}

void main().then((code) => {
  process.exitCode = code;
});
