import { resetTestDatabase, testDatabaseUrl } from '../src/testing';
import {
  currentWorkerId,
  otherWorkerUrls,
  queryRows,
  tableExists,
} from './support/worker-databases';

// A second spec file so that `--maxWorkers=2` can place the two files on different workers.
// Jest may still run both in one worker (in-band heuristic on warm runs), so nothing here
// assumes which worker this file lands on.
const PROBE_TABLE = 'harness_probe_two';

describe('@tms/db/testing harness (second file)', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(async () => {
    await queryRows(testDatabaseUrl(), `DROP TABLE IF EXISTS ${PROBE_TABLE}`);
  });

  it('connects each Jest worker to its own clone', async () => {
    const [row] = await queryRows<{ db: string }>(
      testDatabaseUrl(),
      'SELECT current_database() AS db',
    );
    expect(row?.db).toBe(`tms_w${currentWorkerId()}`);
  });

  it('keeps a table created in this worker database invisible to every other clone', async () => {
    const own = testDatabaseUrl();
    await queryRows(own, `CREATE TABLE ${PROBE_TABLE} (id integer PRIMARY KEY)`);
    expect(await tableExists(own, PROBE_TABLE)).toBe(true);
    const others = await otherWorkerUrls();
    expect(others.length).toBeGreaterThanOrEqual(1);
    for (const url of others) {
      expect(await tableExists(url, PROBE_TABLE)).toBe(false);
    }
  });
});
