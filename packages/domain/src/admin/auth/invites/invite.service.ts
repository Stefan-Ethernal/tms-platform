import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@tms/contracts';
import {
  type AppTransactionHost,
  AuditService,
  MailNotifier,
  TransactionHost,
  UnitOfWork,
} from '../../../shared';
import { AUTH_OPTIONS, type AdminAuthOptions } from '../options';
import { type IssuedSession, SessionService } from '../sessions/session.service';
import { ActionTokenService } from '../tokens/action-token.service';

type Via = 'ADMIN' | 'BOOTSTRAP';

@Injectable()
export class InviteService {
  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly uow: UnitOfWork,
    private readonly tokens: ActionTokenService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly mail: MailNotifier,
    @Inject(AUTH_OPTIONS) private readonly options: AdminAuthOptions,
  ) {}

  async issue(
    userId: string,
    actorUserId: string | null,
    options: { via?: Via; awaitDelivery?: boolean } = {},
  ): Promise<{ expiresAt: Date; url: string }> {
    const via = options.via ?? 'ADMIN';
    const outcome = await this.uow.run(
      async () => {
        const user = await this.txHost.tx.user.findUnique({ where: { id: userId } });
        // Any earlier INVITE token (used, expired or pending) makes this a resend.
        const resent =
          (await this.txHost.tx.actionToken.count({ where: { userId, type: 'INVITE' } })) > 0;
        if (!user || user.kind !== 'STAFF' || user.status !== 'INVITED' || !user.email) {
          await this.recordIssue(resent, 'FAILURE', { userId, actorUserId, via });
          return null;
        }
        await this.sessions.revokeAllSessions(userId);
        const { token, expiresAt } = await this.tokens.issue(
          userId,
          'INVITE',
          this.options.invite.ttlSeconds,
          actorUserId,
        );
        const url = `${this.options.webBaseUrl}/accept-invite#t=${token}`;
        await this.recordIssue(resent, 'SUCCESS', { userId, actorUserId, via, expiresAt });
        this.mail.afterCommit({
          userId,
          to: user.email,
          template: 'invite',
          vars: { firstName: user.firstName, url, expiresAt: expiresAt.toISOString() },
        });
        return { expiresAt, url };
      },
      { awaitEffects: options.awaitDelivery ?? false },
    );
    if (!outcome)
      throw new DomainError(
        'USER_STATE_CONFLICT',
        'Only invited staff users can receive an invite',
      );
    return outcome;
  }

  /** `auth.invite.issued { via, expiresAt }` or `auth.invite.resent { expiresAt }`; FAILURE rows have no `expiresAt`. */
  private async recordIssue(
    resent: boolean,
    outcome: 'SUCCESS' | 'FAILURE',
    p: { userId: string; actorUserId: string | null; via: Via; expiresAt?: Date },
  ): Promise<void> {
    const target = { type: 'User', id: p.userId } as const;
    const expiry = p.expiresAt ? { expiresAt: p.expiresAt.toISOString() } : {};
    if (resent) {
      await this.audit.record({
        action: 'auth.invite.resent',
        outcome,
        actorUserId: p.actorUserId,
        target,
        metadata: expiry,
      });
    } else {
      await this.audit.record({
        action: 'auth.invite.issued',
        outcome,
        actorUserId: p.actorUserId,
        target,
        metadata: { via: p.via, ...expiry },
      });
    }
  }

  async accept(token: string): Promise<IssuedSession> {
    const outcome = await this.uow.run(async () => {
      const consumed = await this.tokens.consume(token, 'INVITE');
      const user = consumed
        ? await this.txHost.tx.user.findUnique({ where: { id: consumed.userId } })
        : null;
      if (!consumed || !user || user.kind !== 'STAFF' || user.status !== 'INVITED') {
        await this.audit.record({
          action: 'auth.invite.accepted',
          outcome: 'FAILURE',
          ...(user ? { target: { type: 'User', id: user.id } } : {}),
          metadata: { reason: 'INVALID_TOKEN' },
        });
        return null;
      }
      await this.txHost.tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: null,
          totpSecretEnc: null,
          totpKeyId: null,
          totpEnabledAt: null,
          totpLastUsedStep: null,
        },
      });
      await this.sessions.revokeAllSessions(user.id);
      const issued = await this.sessions.create(user.id, 'ENROLLMENT', { mfaVerified: false });
      await this.audit.record({
        action: 'auth.invite.accepted',
        outcome: 'SUCCESS',
        actorUserId: user.id,
        target: { type: 'User', id: user.id },
        metadata: {},
      });
      return issued;
    });
    if (!outcome)
      throw new DomainError('AUTH_TOKEN_INVALID', 'This link is invalid or has expired');
    return outcome;
  }
}
