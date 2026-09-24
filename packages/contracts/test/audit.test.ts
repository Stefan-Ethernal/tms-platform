import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ADMIN_AUDIT_ACTIONS,
  AUDIT_ACTION_NAMES,
  AUDIT_ACTIONS,
  AuditActionSchema,
  AuditMetadataError,
  AuditTargetTypeSchema,
  OPS_AUDIT_ACTIONS,
  parseAuditMetadata,
} from '../src/audit/index.js';
import { isSensitiveKey } from '../src/security/scrub.js';

/** Every property key reachable in a schema tree, including nested objects, arrays, optionals and unions. */
function collectKeys(schema: z.ZodType, into: string[] = []): string[] {
  const def = schema.def as {
    type: string;
    shape?: Record<string, z.ZodType>;
    element?: z.ZodType;
    innerType?: z.ZodType;
    options?: z.ZodType[];
  };
  if (def.shape) {
    for (const [key, child] of Object.entries(def.shape)) {
      into.push(key);
      collectKeys(child, into);
    }
  }
  if (def.element) collectKeys(def.element, into);
  if (def.innerType) collectKeys(def.innerType, into);
  if (def.options) for (const option of def.options) collectKeys(option, into);
  return into;
}

describe('AUDIT_ACTIONS', () => {
  it('names every action <area>.<entity>.<event> in kebab-case with a known area', () => {
    expect(AUDIT_ACTION_NAMES.length).toBeGreaterThanOrEqual(45);
    for (const action of AUDIT_ACTION_NAMES) {
      expect(action).toMatch(/^(auth|admin|checkin|system)\.[a-z]+(-[a-z]+)*\.[a-z]+(-[a-z]+)*$/);
    }
    expect(AuditActionSchema.parse('auth.login.failure')).toBe('auth.login.failure');
    expect(AuditActionSchema.safeParse('auth.login.Failure').success).toBe(false);
  });

  it('covers the events named in spec sections 8 to 10', () => {
    for (const action of [
      'auth.invite.issued',
      'auth.invite.accepted',
      'auth.invite.resent',
      'auth.password.set',
      'auth.totp.enrolled',
      'auth.totp.verified',
      'auth.login.success',
      'auth.login.failure',
      'auth.lockout.applied',
      'auth.session.revoked',
      'auth.mfa.reset',
      'auth.password-reset.requested',
      'auth.password-reset.completed',
      'admin.user.created',
      'admin.user.updated',
      'admin.user.blocked',
      'admin.user.unblocked',
      'admin.user.deactivated',
      'admin.user.unlocked',
      'admin.user.role-changed',
      'admin.role.created',
      'admin.role.updated',
      'admin.role.deleted',
      'admin.permission.updated',
      'admin.driver.created',
      'admin.driver.updated',
      'admin.driver.pin-reset',
      'admin.card.issued',
      'admin.card.blocked',
      'admin.carrier.created',
      'admin.carrier.updated',
      'admin.vehicle.created',
      'admin.vehicle.updated',
      'admin.order.created',
      'admin.order.updated',
      'admin.order.cancelled',
      'checkin.identify.success',
      'checkin.identify.failure',
      'checkin.pin.locked',
      'checkin.order.confirmed',
      'checkin.queue.checked-in',
      'checkin.queue.manual-checkin',
      'checkin.queue.point-assigned',
      'checkin.queue.called',
      'checkin.queue.completed',
      'checkin.queue.removed',
      'system.permissions.synced',
      'system.seed.applied',
    ]) {
      expect(AUDIT_ACTIONS, action).toHaveProperty(action);
    }
  });

  it('uses a strict object for every action and no sensitive key anywhere in any schema', () => {
    for (const [action, schema] of Object.entries(AUDIT_ACTIONS)) {
      expect(schema.def.type, action).toBe('object');
      expect(schema.safeParse({ unexpected: 1 }).success, action).toBe(false);
      for (const key of collectKeys(schema)) {
        expect(isSensitiveKey(key), `${action}.${key}`).toBe(false);
      }
    }
  });

  it('lists the 13 audit target types', () => {
    expect(AuditTargetTypeSchema.options).toHaveLength(13);
    expect(AuditTargetTypeSchema.parse('QueueEntry')).toBe('QueueEntry');
  });

  it('keeps the loading-order actions in OPS_AUDIT_ACTIONS, apart from the admin file', () => {
    expect(Object.keys(OPS_AUDIT_ACTIONS)).toEqual([
      'admin.order.created',
      'admin.order.updated',
      'admin.order.cancelled',
    ]);
    expect(Object.keys(ADMIN_AUDIT_ACTIONS).filter((a) => a.startsWith('admin.order.'))).toEqual(
      [],
    );
    expect(AUDIT_ACTION_NAMES).toHaveLength(50);
  });

  it('carries the phase 3 metadata: no PIN, a permission code, export field names only', () => {
    expect(parseAuditMetadata('admin.driver.pin-reset', {})).toEqual({});
    expect(() => parseAuditMetadata('admin.driver.pin-reset', { pin: '1234' })).toThrow(
      /Unrecognized key/,
    );
    expect(parseAuditMetadata('admin.permission.deleted', { code: 'queue:fly' })).toEqual({
      code: 'queue:fly',
    });
    expect(() => parseAuditMetadata('admin.permission.deleted', {})).toThrow(
      'Invalid audit metadata for admin.permission.deleted: code: Invalid input: expected string, received undefined',
    );
    const exported = { list: 'drivers', rowCount: 12, filterFields: ['status', 'carrierId'] };
    expect(parseAuditMetadata('admin.list.exported', exported)).toEqual(exported);
    expect(() =>
      parseAuditMetadata('admin.list.exported', { ...exported, filters: { status: 'ACTIVE' } }),
    ).toThrow(/Unrecognized key: "filters"/);
    expect(() =>
      parseAuditMetadata('admin.list.exported', { ...exported, filterFields: ['status=ACTIVE'] }),
    ).toThrow(/filterFields\.0: Invalid string/);
  });
});

describe('parseAuditMetadata', () => {
  it('accepts undefined and {} for an empty schema and returns {}', () => {
    expect(parseAuditMetadata('admin.user.created', undefined)).toEqual({});
    expect(parseAuditMetadata('admin.user.created', {})).toEqual({});
  });

  it('returns the typed metadata of a populated schema', () => {
    const parsed = parseAuditMetadata('auth.login.failure', {
      method: 'TOTP',
      reason: 'CODE_REPLAYED',
    });
    expect(parsed).toEqual({ method: 'TOTP', reason: 'CODE_REPLAYED' });
    const synced = parseAuditMetadata('system.permissions.synced', {
      inserted: 3,
      reactivated: 0,
      deprecated: 1,
      deleted: 0,
      renamed: 2,
    });
    expect(synced.renamed).toBe(2);
  });

  it('rejects unknown keys with an unrecognized_keys issue naming the key', () => {
    let caught: unknown;
    try {
      parseAuditMetadata('admin.user.created', { password: 'x' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AuditMetadataError);
    const error = caught as AuditMetadataError;
    expect(error.name).toBe('AuditMetadataError');
    expect(error.action).toBe('admin.user.created');
    expect(error.issues.map((i) => i.code)).toEqual(['unrecognized_keys']);
    expect(error.message).toBe(
      'Invalid audit metadata for admin.user.created: <root>: Unrecognized key: "password"',
    );
    expect(error.message).not.toContain(': x');
  });

  it('rejects a wrong enum value and a missing required key', () => {
    expect(() =>
      parseAuditMetadata('auth.login.failure', { method: 'PASSWORD', reason: 'OOPS' }),
    ).toThrow(/reason: Invalid option/);
    expect(() => parseAuditMetadata('checkin.queue.removed', {})).toThrow(
      'Invalid audit metadata for checkin.queue.removed: reason: Invalid input: expected string, received undefined',
    );
    expect(() => parseAuditMetadata('checkin.queue.removed', { reason: 'x'.repeat(201) })).toThrow(
      /reason: Too big/,
    );
  });

  it('rejects an action that is not in the catalogue', () => {
    expect(() => parseAuditMetadata('auth.login.oops' as never, {})).toThrow(
      'Invalid audit metadata for auth.login.oops: <root>: unknown audit action',
    );
  });
});
