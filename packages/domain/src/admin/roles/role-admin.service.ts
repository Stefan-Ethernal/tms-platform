import { Inject, Injectable } from '@nestjs/common';
import { DomainError, type RoleDetailResponse, type RoleSummary } from '@tms/contracts';
import { type AppTransactionHost, TransactionHost } from '../../shared';

/** Lists the roles STAFF users can be assigned; role creation/editing is a later feature. */
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

  /** One STAFF role with the permissions it grants (current Permission name/description), by code. */
  async get(id: string): Promise<RoleDetailResponse> {
    const role = await this.db.role.findFirst({
      where: { id, appliesTo: 'STAFF' },
      select: {
        id: true,
        key: true,
        name: true,
        appliesTo: true,
        permissions: {
          orderBy: { permissionCode: 'asc' },
          select: {
            permission: { select: { code: true, group: true, name: true, description: true } },
          },
        },
      },
    });
    if (!role) throw new DomainError('NOT_FOUND', 'Role not found');
    const { permissions, ...summary } = role;
    return { ...summary, permissions: permissions.map((rp) => rp.permission) };
  }
}
