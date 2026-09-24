#!/usr/bin/env node
import { PERMISSIONS } from '@tms/contracts';
import { createPrismaClient } from '../index';
import { syncPermissions } from '../sync/apply';
import {
  describeFailure,
  EXIT_CONFIG,
  EXIT_FAILURE,
  loadDotEnv,
  printEvent,
  requireDatabaseUrl,
} from './support';

async function main(): Promise<number> {
  loadDotEnv();
  const url = requireDatabaseUrl(process.env, process.stderr);
  if (!url) return EXIT_CONFIG;

  const client = createPrismaClient({ url });
  try {
    const report = await syncPermissions(client, PERMISSIONS);
    printEvent('permissions.synced', report);
    return 0;
  } catch (error) {
    process.stderr.write(`${describeFailure('permission sync failed', error)}\n`);
    return EXIT_FAILURE;
  } finally {
    await client.$disconnect();
  }
}

void main().then((code) => {
  process.exitCode = code;
});
