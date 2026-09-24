import fc from 'fast-check';
import { validateCatalogue, type PermissionDefinition } from '@tms/contracts';
import {
  isEmptyPlan,
  planPermissionSync,
  type GrantRow,
  type RoleRow,
  type SyncState,
} from '../../src/sync/plan';
import { applyPlanToState } from '../support/sync-model';

const GROUPS = ['users', 'roles', 'queue', 'checkin'] as const;
const ACTIONS = ['read', 'manage', 'call', 'remove'] as const;
const ALL_CODES = GROUPS.flatMap((g) => ACTIONS.map((a) => `${g}:${a}`));
const ROLES: readonly RoleRow[] = [
  { id: 'r-admin', key: 'admin', appliesTo: 'STAFF' },
  { id: 'r-operator', key: 'operator', appliesTo: 'STAFF' },
  { id: 'r-custom', key: null, appliesTo: 'STAFF' },
  { id: 'r-driver', key: 'driver', appliesTo: 'DRIVER' },
];
const LOCKED = {
  lockedRoles: [
    { key: 'admin', appliesTo: 'STAFF' as const },
    { key: 'driver', appliesTo: 'DRIVER' as const },
  ],
};
const groupOf = (code: string): string => code.slice(0, code.indexOf(':'));

// Live codes plus up to three retired codes, each attached to one live entry's renamedFrom.
const catalogueArb: fc.Arbitrary<PermissionDefinition[]> = fc
  .uniqueArray(fc.constantFrom(...ALL_CODES), { minLength: 1, maxLength: 6 })
  .chain((live) => {
    const spare = ALL_CODES.filter((c) => !live.includes(c));
    return fc
      .tuple(
        fc.subarray(spare, { maxLength: 3 }),
        fc.array(fc.nat({ max: live.length - 1 }), { minLength: 3, maxLength: 3 }),
      )
      .map(([retired, targets]) =>
        live.map((code, i) => {
          const renamedFrom = retired.filter((_, j) => targets[j] === i);
          return {
            code,
            group: groupOf(code),
            audience: groupOf(code) === 'checkin' ? 'DRIVER' : 'STAFF',
            defaultName: `${code} name`,
            defaultDescription: `${code} description`,
            ...(renamedFrom.length > 0 ? { renamedFrom } : {}),
          } as unknown as PermissionDefinition;
        }),
      );
  })
  .filter((catalogue) => validateCatalogue(catalogue).length === 0);

const stateArb: fc.Arbitrary<SyncState> = fc
  .uniqueArray(fc.constantFrom(...ALL_CODES), { maxLength: 8 })
  .chain((codes) =>
    fc
      .tuple(
        fc.array(
          fc.record({ isDeprecated: fc.boolean(), regrouped: fc.boolean(), edited: fc.boolean() }),
          {
            minLength: codes.length,
            maxLength: codes.length,
          },
        ),
        fc.subarray(
          ROLES.flatMap((r) => codes.map((code) => ({ roleId: r.id, permissionCode: code }))),
        ),
        fc.subarray([...ROLES], { minLength: 1 }),
      )
      .map(([flags, grants, roles]) => ({
        permissions: codes.map((code, i) => ({
          code,
          group: flags[i]!.regrouped ? 'legacy' : groupOf(code),
          name: flags[i]!.edited ? `${code} (edited)` : `${code} name`,
          description: `${code} description`,
          isDeprecated: flags[i]!.isDeprecated,
        })),
        grants: grants.filter((g) => roles.some((r) => r.id === g.roleId)),
        roles,
      })),
  );

const renameTarget = (catalogue: readonly PermissionDefinition[]): Map<string, string> =>
  new Map(catalogue.flatMap((d) => (d.renamedFrom ?? []).map((from) => [from, d.code as string])));
const key = (g: GrantRow, resolve: (code: string) => string): string =>
  `${g.roleId}|${resolve(g.permissionCode)}`;

describe('planPermissionSync properties', () => {
  it('A: planning against the applied state yields an empty plan (sync(sync(c)) == sync(c))', () => {
    fc.assert(
      fc.property(stateArb, catalogueArb, (state, catalogue) => {
        const plan = planPermissionSync(state, catalogue, LOCKED);
        const after = applyPlanToState(state, plan);
        expect(isEmptyPlan(planPermissionSync(after, catalogue, LOCKED))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('B: every grant of a non-locked role is preserved modulo renames', () => {
    fc.assert(
      fc.property(stateArb, catalogueArb, (state, catalogue) => {
        const lockedKeys = new Set(LOCKED.lockedRoles.map((l) => l.key));
        const free = new Set(
          state.roles.filter((r) => r.key === null || !lockedKeys.has(r.key)).map((r) => r.id),
        );
        const targets = renameTarget(catalogue);
        const resolve = (code: string): string => targets.get(code) ?? code;
        const plan = planPermissionSync(state, catalogue, LOCKED);
        const after = applyPlanToState(state, plan);
        const before = new Set(
          state.grants.filter((g) => free.has(g.roleId)).map((g) => key(g, resolve)),
        );
        const afterKeys = new Set(
          after.grants.filter((g) => free.has(g.roleId)).map((g) => key(g, (c) => c)),
        );
        expect(afterKeys).toEqual(before);
      }),
      { numRuns: 300 },
    );
  });

  it('C: a code still referenced after renames is never deleted, and no grant dangles', () => {
    fc.assert(
      fc.property(stateArb, catalogueArb, (state, catalogue) => {
        const plan = planPermissionSync(state, catalogue, LOCKED);
        const after = applyPlanToState(state, plan);
        const codes = new Set(after.permissions.map((p) => p.code));
        for (const g of after.grants) {
          expect(plan.delete).not.toContain(g.permissionCode);
          expect(codes.has(g.permissionCode)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});
