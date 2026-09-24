import { harnessGlobals } from './global-setup';

/** Jest globalTeardown: stops the container; Ryuk removes it if this never runs. */
export default async function globalTeardown(): Promise<void> {
  const container = harnessGlobals.__TMS_PG_CONTAINER__;
  if (!container) return;
  const startedAt = performance.now();
  await container.stop();
  harnessGlobals.__TMS_PG_CONTAINER__ = undefined;
  console.log(`[db-harness] container stopped in ${(performance.now() - startedAt).toFixed(0)} ms`);
}
