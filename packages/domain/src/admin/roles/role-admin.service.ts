import { Inject, Injectable } from '@nestjs/common';
import type { RoleSummary } from '@tms/contracts';
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
}
