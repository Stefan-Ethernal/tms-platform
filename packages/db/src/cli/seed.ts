#!/usr/bin/env node
import { createPrismaClient } from '../index';
import { SeedConfigError, seedDatabase } from '../seed/seed';
import {
  describeFailure,
  EXIT_CONFIG,
  EXIT_FAILURE,
  loadDotEnv,
  printEvent,
  readBootstrapAdmin,
  requireDatabaseUrl,
} from './support';

async function main(): Promise<number> {
  loadDotEnv();
  const url = requireDatabaseUrl(process.env, process.stderr);
  if (!url) return EXIT_CONFIG;
  const bootstrapAdmin = readBootstrapAdmin(process.env, process.stderr);
  if (!bootstrapAdmin) return EXIT_CONFIG;

  const client = createPrismaClient({ url });
  try {
    const report = await seedDatabase(client, { bootstrapAdmin });
    printEvent('seed.applied', report);
    return 0;
  } catch (error) {
    process.stderr.write(`${describeFailure('seed failed', error)}\n`);
    return error instanceof SeedConfigError ? EXIT_CONFIG : EXIT_FAILURE;
  } finally {
    await client.$disconnect();
  }
}

void main().then((code) => {
  process.exitCode = code;
});
