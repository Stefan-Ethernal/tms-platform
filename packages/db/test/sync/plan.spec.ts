import type { PermissionDefinition } from '@tms/contracts';
import {
  CatalogueInvalidError,
  isEmptyPlan,
  planPermissionSync,
  type GrantRow,
  type PermissionRow,
  type RoleRow,
  type SyncPlan,
  type SyncState,
} from '../../src/sync/plan';
import { applyPlanToState } from '../support/sync-model';

const groupOf = (code: string): string => code.slice(0, code.indexOf(':'));
const def = (code: string, extra: Partial<PermissionDefinition> = {}): PermissionDefinition =>
  ({
    code,
    group: groupOf(code),
    audience: 'STAFF',
    defaultName: `${code} name`,
    defaultDescription: `${code} description`,
    ...extra,
  }) as PermissionDefinition;
const row = (code: string, extra: Partial<PermissionRow> = {}): PermissionRow => ({
  code,
  group: groupOf(code),
  name: `${code} name`,
  description: `${code} description`,
  isDeprecated: false,
  ...extra,
});
const ADMIN: RoleRow = { id: 'role-admin', key: 'admin', appliesTo: 'STAFF' };
const OPERATOR: RoleRow = { id: 'role-operator', key: 'operator', appliesTo: 'STAFF' };
const CUSTOM: RoleRow = { id: 'role-custom', key: null, appliesTo: 'STAFF' };
const grant = (role: RoleRow, code: string): GrantRow => ({
  roleId: role.id,
  permissionCode: code,
});
const state = (
  permissions: PermissionRow[],
  grants: GrantRow[] = [],
  roles: RoleRow[] = [ADMIN, OPERATOR, CUSTOM],
): SyncState => ({ permissions, grants, roles });
const UNLOCKED = { lockedRoles: [] };
const LOCKED = { lockedRoles: [{ key: 'admin', appliesTo: 'STAFF' as const }] };
const EMPTY: SyncPlan = {
  inserts: [],
  regroup: [],
  reactivate: [],
  renames: [],
  lockedRoleGrants: [],
  deprecate: [],
  delete: [],
};

describe('planPermissionSync', () => {
  it('inserts catalogue codes missing from the database with their default texts', () => {
    const plan = planPermissionSync(
      state([row('users:read')]),
      [def('users:read'), def('users:create')],
      UNLOCKED,
    );
    expect(plan).toEqual({ ...EMPTY, inserts: [row('users:create')] });
  });

  it('never touches an admin-edited name or description', () => {
    const edited = row('users:read', { name: 'See people', description: 'Edited in the UI' });
    expect(planPermissionSync(state([edited]), [def('users:read')], UNLOCKED)).toEqual(EMPTY);
  });

  it('regroups a code whose group changed in the catalogue', () => {
    const plan = planPermissionSync(
      state([row('queue:call', { group: 'orders' })]),
      [def('queue:call')],
      UNLOCKED,
    );
    expect(plan).toEqual({ ...EMPTY, regroup: [{ code: 'queue:call', group: 'queue' }] });
  });

  it('reactivates a deprecated code that is back in the catalogue', () => {
    const plan = planPermissionSync(
      state([row('queue:call', { isDeprecated: true })]),
      [def('queue:call')],
      UNLOCKED,
    );
    expect(plan).toEqual({ ...EMPTY, reactivate: ['queue:call'] });
  });

  it('moves grants from a renamed code and removes the old code', () => {
    const plan = planPermissionSync(
      state([row('queue:summon')], [grant(OPERATOR, 'queue:summon')]),
      [def('queue:call', { renamedFrom: ['queue:summon'] })],
      UNLOCKED,
    );
    expect(plan).toEqual({
      ...EMPTY,
      inserts: [row('queue:call')],
      renames: [
        {
          from: 'queue:summon',
          to: 'queue:call',
          grantsToMove: [grant(OPERATOR, 'queue:summon')],
          grantsToDrop: [],
        },
      ],
      delete: ['queue:summon'],
    });
  });

  it('drops the old grant when the role already holds the new code', () => {
    const plan = planPermissionSync(
      state(
        [row('queue:summon'), row('queue:call')],
        [
          grant(CUSTOM, 'queue:summon'),
          grant(CUSTOM, 'queue:call'),
          grant(OPERATOR, 'queue:summon'),
        ],
      ),
      [def('queue:call', { renamedFrom: ['queue:summon'] })],
      UNLOCKED,
    );
    expect(plan.renames).toEqual([
      {
        from: 'queue:summon',
        to: 'queue:call',
        grantsToMove: [grant(OPERATOR, 'queue:summon')],
        grantsToDrop: [grant(CUSTOM, 'queue:summon')],
      },
    ]);
    expect(plan.delete).toEqual(['queue:summon']);
  });

  it('resolves a chained rename a -> b -> c for databases on either old name', () => {
    const plan = planPermissionSync(
      state(
        [row('queue:page'), row('queue:summon')],
        [
          grant(OPERATOR, 'queue:page'),
          grant(CUSTOM, 'queue:summon'),
          grant(ADMIN, 'queue:page'),
          grant(ADMIN, 'queue:summon'),
        ],
      ),
      [def('queue:call', { renamedFrom: ['queue:page', 'queue:summon'] })],
      UNLOCKED,
    );
    expect(plan.renames).toEqual([
      {
        from: 'queue:page',
        to: 'queue:call',
        grantsToMove: [grant(OPERATOR, 'queue:page'), grant(ADMIN, 'queue:page')],
        grantsToDrop: [],
      },
      {
        from: 'queue:summon',
        to: 'queue:call',
        grantsToMove: [grant(CUSTOM, 'queue:summon')],
        grantsToDrop: [grant(ADMIN, 'queue:summon')],
      },
    ]);
    expect(plan.delete).toEqual(['queue:page', 'queue:summon']);
  });

  it('deprecates a referenced code and deletes an unreferenced one in the same run', () => {
    const plan = planPermissionSync(
      state(
        [row('users:read'), row('legacy:referenced'), row('legacy:orphan')],
        [grant(CUSTOM, 'legacy:referenced')],
      ),
      [def('users:read')],
      UNLOCKED,
    );
    expect(plan).toEqual({ ...EMPTY, deprecate: ['legacy:referenced'], delete: ['legacy:orphan'] });
  });

  it('does not deprecate an already deprecated referenced code again', () => {
    const plan = planPermissionSync(
      state(
        [row('users:read'), row('legacy:referenced', { isDeprecated: true })],
        [grant(CUSTOM, 'legacy:referenced')],
      ),
      [def('users:read')],
      UNLOCKED,
    );
    expect(plan).toEqual(EMPTY);
  });

  it('gives the locked Admin role every new STAFF code and takes deprecated ones away', () => {
    const plan = planPermissionSync(
      state(
        [row('users:read'), row('legacy:old')],
        [grant(ADMIN, 'users:read'), grant(ADMIN, 'legacy:old')],
      ),
      [def('users:read'), def('users:create'), def('checkin:perform', { audience: 'DRIVER' })],
      LOCKED,
    );
    expect(plan).toEqual({
      ...EMPTY,
      inserts: [row('users:create'), row('checkin:perform')],
      lockedRoleGrants: [{ roleId: ADMIN.id, add: ['users:create'], remove: ['legacy:old'] }],
      delete: ['legacy:old'],
    });
  });

  it('never grants a DRIVER-audience code to the locked STAFF admin', () => {
    const plan = planPermissionSync(
      state([row('users:read'), row('checkin:perform')], [], [ADMIN]),
      [def('users:read'), def('checkin:perform', { audience: 'DRIVER' })],
      LOCKED,
    );
    expect(plan.lockedRoleGrants).toEqual([{ roleId: ADMIN.id, add: ['users:read'], remove: [] }]);
  });

  it('leaves a locked role alone when its key is absent from the database', () => {
    expect(
      planPermissionSync(state([row('users:read')], [], [CUSTOM]), [def('users:read')], LOCKED),
    ).toEqual(EMPTY);
  });

  it('throws CatalogueInvalidError before planning anything for an invalid catalogue', () => {
    const invalid = [def('users:read'), def('users:read')];
    expect(() => planPermissionSync(state([]), invalid, UNLOCKED)).toThrow(CatalogueInvalidError);
    let caught: unknown;
    try {
      planPermissionSync(state([]), invalid, UNLOCKED);
    } catch (error) {
      caught = error;
    }
    expect((caught as CatalogueInvalidError).name).toBe('CatalogueInvalidError');
    expect((caught as CatalogueInvalidError).problems.length).toBeGreaterThan(0);
  });

  it('is idempotent on a scenario exercising every rule', () => {
    const catalogue = [
      def('users:read'),
      def('users:create'),
      def('queue:call', { renamedFrom: ['queue:summon'] }),
      def('checkin:perform', { audience: 'DRIVER' }),
    ];
    const before = state(
      [
        row('users:read', { name: 'People' }),
        row('queue:summon'),
        row('legacy:kept'),
        row('legacy:orphan'),
        row('checkin:perform', { isDeprecated: true, group: 'kiosk' }),
      ],
      [
        grant(ADMIN, 'users:read'),
        grant(ADMIN, 'legacy:kept'),
        grant(OPERATOR, 'queue:summon'),
        grant(CUSTOM, 'legacy:kept'),
        grant(CUSTOM, 'queue:summon'),
      ],
    );
    const plan = planPermissionSync(before, catalogue, LOCKED);
    expect(isEmptyPlan(plan)).toBe(false);
    const after = applyPlanToState(before, plan);
    const second = planPermissionSync(after, catalogue, LOCKED);
    expect(second).toEqual(EMPTY);
    expect(isEmptyPlan(second)).toBe(true);
    expect(after.permissions.find((p) => p.code === 'users:read')?.name).toBe('People');
  });
});
