import { Prisma } from '../../src';

export interface ExpectedKnownRequestError {
  /** P2002 = unique constraint violated, P2003 = foreign key constraint violated. */
  code: 'P2002' | 'P2003';
  /** Constraint name as Postgres reports it, e.g. `User_email_key`, `RolePermission_permissionCode_fkey`. */
  constraint: string;
}

/**
 * Awaits a Prisma operation that must be rejected and asserts its code and the violated constraint.
 * Prisma 7 driver-adapter errors carry the constraint at `meta.driverAdapterError.cause.constraint.index`;
 * the classic `meta.target` field no longer exists.
 */
export async function expectKnownRequestError(
  operation: Promise<unknown>,
  expected: ExpectedKnownRequestError,
): Promise<Prisma.PrismaClientKnownRequestError> {
  let caught: unknown;
  try {
    await operation;
  } catch (error) {
    caught = error;
  }
  if (caught === undefined) {
    throw new Error(
      `expected ${expected.code} on ${expected.constraint}, but the operation succeeded`,
    );
  }
  expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  const known = caught as Prisma.PrismaClientKnownRequestError;
  expect(known.code).toBe(expected.code);
  expect(known.meta).toMatchObject({
    driverAdapterError: { cause: { constraint: { index: expected.constraint } } },
  });
  return known;
}
