import { Inject, Injectable } from '@nestjs/common';
import {
  DomainError,
  PERMISSION_GROUPS,
  type RoleDetailResponse,
  type RoleSummary,
} from '@tms/contracts';
import { type AppTransactionHost, TransactionHost } from '../../shared';

/** Lists the roles STAFF users can be assigned and shows one role's permissions; role creation/editing is a later feature. */
@Injectable()
export class RoleAdminService {
  constructor(@Inject(TransactionHost) private readonly txHost: AppTransactionHost) {}

  private get db() {
    return this.txHost.tx;
  }

  async list(): Promise<RoleSummary[]> {
    return this.db.role.findMany({
      where: { appliesTo: 'STAFF' },
      orderBy: { name: 'asc' },
      select: { id: true, key: true, name: true, appliesTo: true },
    });
  }

  /**
   * One role (STAFF or DRIVER) with its permissions grouped in `PERMISSION_GROUPS` order, by `code`
   * inside a group; groups without permissions are omitted. Deprecated permissions the role still
   * holds are included, flagged. Throws `NOT_FOUND` for an unknown id.
   */
  async get(id: string): Promise<RoleDetailResponse> {
    const role = await this.db.role.findUnique({
      where: { id },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        appliesTo: true,
        permissions: {
          select: {
            permission: {
              select: {
                code: true,
                group: true,
                name: true,
                description: true,
                isDeprecated: true,
              },
            },
          },
        },
      },
    });
    if (!role) throw new DomainError('NOT_FOUND', 'Role not found');

    const held = role.permissions.map((p) => p.permission);
    const groups = PERMISSION_GROUPS.map((group) => ({
      group,
      permissions: held
        .filter((p) => p.group === group)
        .map(({ code, name, description, isDeprecated }) => ({
          code,
          name,
          description,
          isDeprecated,
        }))
        .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
    })).filter((g) => g.permissions.length > 0);
    // Field by field: a column later added to the select must not reach the client unnoticed.
    return {
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      appliesTo: role.appliesTo,
      groups,
    };
  }
}
