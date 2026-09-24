import { describe, expect, it } from 'vitest';
import { DB_MIRRORED_ENUMS, UserKindSchema } from '../src/enums.js';

const PRISMA_ENUM_NAMES = [
  'UserKind',
  'UserStatus',
  'DriverType',
  'IdentityCardStatus',
  'SessionScope',
  'ActionTokenType',
  'VehicleKind',
  'LoadingPointKind',
  'TransportKind',
  'LoadingOrderStatus',
  'QueueEntryStatus',
  'CheckInVia',
  'AuditApp',
  'AuditOutcome',
];

describe('DB_MIRRORED_ENUMS', () => {
  it('is keyed by exactly the 14 Prisma enum names', () => {
    expect(Object.keys(DB_MIRRORED_ENUMS).sort()).toEqual([...PRISMA_ENUM_NAMES].sort());
  });

  it.each(Object.entries(DB_MIRRORED_ENUMS))(
    '%s has at least two unique UPPER_SNAKE values',
    (_name, schema) => {
      expect(schema.options.length).toBeGreaterThanOrEqual(2);
      expect(new Set(schema.options).size).toBe(schema.options.length);
      for (const value of schema.options) expect(value).toMatch(/^[A-Z][A-Z0-9_]*$/);
    },
  );

  it('parses a member and rejects a non-member with an invalid_value issue', () => {
    expect(UserKindSchema.parse('STAFF')).toBe('STAFF');
    const result = UserKindSchema.safeParse('staff');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.code).toBe('invalid_value');
  });
});
