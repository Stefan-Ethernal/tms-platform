# Phase 2 — Task 07: db — auth fields migration

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Modify: `packages/db/prisma/schema.prisma` (models `User`, `ActionToken`)
- Create: `packages/db/prisma/migrations/<timestamp>_auth_fields/migration.sql` (generated)
- Create: `packages/db/test/auth-fields.spec.ts`

**Interfaces:**
- Consumes: phase 1 models and the Testcontainers harness (`testDatabaseUrl`, `resetTestDatabase`, `makeStaffUser` from `@tms/db/testing`), `createPrismaClient`. Phase 1 already has `ActionToken.createdById String? @db.Uuid` (relation `"ActionTokenCreatedBy"`, phase 1 deviation 3) and `Session @@index([userId])`; this task does not touch them.
- Produces: `User.lockoutLevel Int @default(0)`; `ActionToken @@index([userId, type])` in place of phase 1's `@@index([userId])` (the composite index serves both the per-user and the per-user-and-type lookups). Consumed by Tasks 11, 13, 16, 20.

This is the only migration of phase 2 (D7): rebase on `main` and regenerate it if any other migration merged first.

- [ ] **Step 1: Write the failing test**

`packages/db/test/auth-fields.spec.ts` (same client lifecycle and raw-SQL style as phase 1's `schema-identity.spec.ts`):

```ts
import { createPrismaClient, type PrismaClient } from '../src';
import { makeStaffUser, resetTestDatabase, testDatabaseUrl } from '../src/testing';

describe('phase 2 auth fields', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    await resetTestDatabase();
    prisma = createPrismaClient({ url: testDatabaseUrl() });
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  it('defaults lockoutLevel to 0', async () => {
    const user = await makeStaffUser(prisma, { status: 'INVITED' });
    expect(user.lockoutLevel).toBe(0);
  });

  it('indexes action tokens by user and type instead of by user alone', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'ActionToken'
      ORDER BY indexname`;

    expect(rows.map((row) => row.indexname)).toEqual([
      'ActionToken_pkey',
      'ActionToken_tokenHash_key',
      'ActionToken_userId_type_idx',
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm turbo run test --filter=@tms/db`
Expected: FAIL, 2 tests (ts-jest transpiles without type-checking, `isolatedModules`): `defaults lockoutLevel to 0` — `Expected: 0, Received: undefined`; the index test lists `ActionToken_userId_idx` instead of `ActionToken_userId_type_idx`. Phase 1's suites stay green. `pnpm turbo run typecheck --filter=@tms/db` reports TS2339 `Property 'lockoutLevel' does not exist`.

- [ ] **Step 3: Change the schema and generate the migration**

In `packages/db/prisma/schema.prisma`:

```prisma
model User {
  // ... phase 1 fields unchanged ...
  failedLoginCount Int        @default(0)
  lockoutLevel     Int        @default(0) // consecutive lockouts since the last successful login or admin unlock (phase 2)
  lockedUntil      DateTime?  @db.Timestamptz(3)
  // ...
}

model ActionToken {
  // ... phase 1 fields unchanged ...
  @@index([userId, type]) // replaces phase 1's @@index([userId])
}
```

Run against the throwaway database (see Execution notes; turbo passes the arguments after `--` to `prisma migrate dev`, phase 1 Task 02):
```bash
DATABASE_URL=postgresql://tms:tms@localhost:56432/tms pnpm turbo run db:migrate:deploy --filter=@tms/db
DATABASE_URL=postgresql://tms:tms@localhost:56432/tms pnpm turbo run db:migrate:dev --filter=@tms/db -- --name auth_fields --create-only
```
Expected: `@tms/db:db:migrate:dev: $ prisma migrate dev --name auth_fields --create-only`, then `Prisma Migrate created the following migration without applying it <timestamp>_auth_fields`. Generated `migration.sql` (order may differ):
```sql
DROP INDEX "ActionToken_userId_idx";
ALTER TABLE "User" ADD COLUMN "lockoutLevel" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "ActionToken_userId_type_idx" ON "ActionToken"("userId", "type");
```
Review the file: no `DROP` of data, no table rewrite beyond the column default.

- [ ] **Step 4: Run the tests and the drift check**

Run: `pnpm turbo run test --filter=@tms/db && DATABASE_URL=postgresql://tms:tms@localhost:56432/tms pnpm turbo run db:migrate:deploy --filter=@tms/db && DATABASE_URL=postgresql://tms:tms@localhost:56432/tms pnpm turbo run db:drift --filter=@tms/db`
Expected: all db tests pass (the 2 new ones plus phase 1's enum-parity, constraint and index tests); `db:drift` exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma packages/db/test/auth-fields.spec.ts docs/efficiency/critical-path.md
git commit -m "feat(db): add the lockout level and index action tokens by user and type"
```

PR body: diagram `erDiagram` (User, ActionToken with the changed field and index); boundaries: `@tms/db`, migration yes (reversible: yes — drop the column, drop `ActionToken_userId_type_idx`, recreate `ActionToken_userId_idx`); verification: test counts, generated SQL, drift output; reviewer: `security-reviewer` (lockout data model).
