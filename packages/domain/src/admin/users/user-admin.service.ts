import { Inject, Injectable } from '@nestjs/common';
import { DomainError, type UserSummary } from '@tms/contracts';
import {
  type AppTransactionHost,
  AuditService,
  type Principal,
  TransactionHost,
  UnitOfWork,
} from '../../shared';
import { InviteService } from '../auth/invites/invite.service';

export interface CreateUserInput {
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
}

/** Creates back-office (STAFF) users and lists them; driver creation is a separate, later feature. */
@Injectable()
export class UserAdminService {
  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly invites: InviteService,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  async create(
    actor: Principal,
    input: CreateUserInput,
  ): Promise<{ userId: string; expiresAt: Date }> {
    return this.uow.run(async () => {
      const role = await this.db.role.findUnique({ where: { id: input.roleId } });
      if (!role || role.appliesTo !== 'STAFF') {
        throw new DomainError('ROLE_KIND_MISMATCH', 'This role cannot be assigned to a staff user');
      }
      const user = await this.db.user.create({
        data: {
          kind: 'STAFF',
          username: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          status: 'INVITED',
          roleId: input.roleId,
          locale: 'en',
          createdById: actor.userId,
        },
      });
      await this.audit.record({
        action: 'admin.user.created',
        outcome: 'SUCCESS',
        actorUserId: actor.userId,
        target: { type: 'User', id: user.id },
        metadata: {},
      });
      // Joins this unit of work: the invite mail is sent only after the outer commit.
      const { expiresAt } = await this.invites.issue(user.id, actor.userId, { via: 'ADMIN' });
      return { userId: user.id, expiresAt };
    });
  }

  async list(): Promise<UserSummary[]> {
    const users = await this.db.user.findMany({
      where: { kind: 'STAFF' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        kind: true,
        role: { select: { id: true, key: true, name: true } },
      },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      status: u.status,
      kind: u.kind,
      role: { id: u.role.id, key: u.role.key, name: u.role.name },
    }));
  }
}
