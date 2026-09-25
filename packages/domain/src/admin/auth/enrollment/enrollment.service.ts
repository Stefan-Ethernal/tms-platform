import { Inject, Injectable } from '@nestjs/common';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  MFA_MAX_ATTEMPTS,
  normalizeRecoveryCode,
  type PasswordHasher,
  type RandomSource,
  type SecretCipher,
  type TotpProvider,
} from '@tms/auth-core';
import { DomainError } from '@tms/contracts';
import {
  type AppTransactionHost,
  AuditService,
  Clock,
  type Principal,
  TransactionHost,
  UnitOfWork,
} from '../../../shared';
import { assertStrongPassword, totpAad } from '../credentials';
import { AUTH_OPTIONS, type AdminAuthOptions } from '../options';
import { PASSWORD_HASHER, RANDOM_SOURCE, SECRET_CIPHER, TOTP_PROVIDER } from '../ports';
import { type IssuedSession, SessionService } from '../sessions/session.service';

@Injectable()
export class EnrollmentService {
  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly uow: UnitOfWork,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
    @Inject(TOTP_PROVIDER) private readonly totp: TotpProvider,
    @Inject(RANDOM_SOURCE) private readonly random: RandomSource,
    @Inject(AUTH_OPTIONS) private readonly options: AdminAuthOptions,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  async setPassword(principal: Principal, password: string): Promise<void> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: principal.userId } });
    if (user.status !== 'INVITED')
      throw new DomainError('USER_STATE_CONFLICT', 'The password was already verified');
    assertStrongPassword(password, user);
    const passwordHash = await this.hasher.hash(password);
    await this.uow.run(async () => {
      await this.db.user.update({ where: { id: user.id }, data: { passwordHash } });
      await this.audit.record({
        action: 'auth.password.set',
        outcome: 'SUCCESS',
        actorUserId: user.id,
        target: { type: 'User', id: user.id },
        metadata: {},
      });
    });
  }

  async startTotp(principal: Principal): Promise<{ otpauthUri: string; secret: string }> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: principal.userId } });
    if (!user.passwordHash || !user.email)
      throw new DomainError('USER_STATE_CONFLICT', 'Set a password first');
    const secret = this.totp.generateSecret();
    await this.db.session.update({
      where: { id: principal.sessionId },
      data: { totpPendingSecretEnc: this.cipher.encrypt(secret, totpAad(user.id)) },
    });
    return {
      otpauthUri: this.totp.buildUri({
        issuer: this.options.totpIssuer,
        account: user.email,
        secret,
      }),
      secret,
    };
  }

  async confirmTotp(
    principal: Principal,
    code: string,
  ): Promise<{ issued: IssuedSession; recoveryCodes: string[] }> {
    const session = await this.db.session.findUniqueOrThrow({ where: { id: principal.sessionId } });
    if (!session.totpPendingSecretEnc)
      throw new DomainError('USER_STATE_CONFLICT', 'Start the authenticator setup first');
    const secret = this.cipher.decrypt(session.totpPendingSecretEnc, totpAad(principal.userId));
    const now = this.clock.now();
    const verification = await this.totp.verify({ secret, code, now, lastUsedStep: null });

    const outcome = await this.uow.run(async () => {
      if (!verification.ok) {
        const attempts = await this.sessions.recordMfaFailure(session.id);
        await this.audit.record({
          action: 'auth.totp.enrolled',
          outcome: 'FAILURE',
          actorUserId: principal.userId,
          target: { type: 'User', id: principal.userId },
          metadata: {
            reason: attempts >= MFA_MAX_ATTEMPTS ? 'TOO_MANY_MFA_ATTEMPTS' : 'INVALID_CODE',
          },
        });
        if (attempts >= MFA_MAX_ATTEMPTS) {
          await this.sessions.destroy(session.id);
          return { kind: 'exhausted' as const };
        }
        return { kind: 'invalid' as const };
      }
      // Single use of the pending secret: the first statement of the winning transaction row-locks the
      // session; a parallel confirm waits here, re-reads the row after the commit and finds nothing to claim.
      const claimed = await this.db.session.updateMany({
        where: { id: session.id, totpPendingSecretEnc: { not: null } },
        data: { totpPendingSecretEnc: null },
      });
      if (claimed.count !== 1) return { kind: 'conflict' as const };
      const user = await this.db.user.findUniqueOrThrow({ where: { id: principal.userId } });
      const recoveryCodes = generateRecoveryCodes(this.random);
      await this.db.user.update({
        where: { id: user.id },
        data: {
          totpSecretEnc: this.cipher.encrypt(secret, totpAad(user.id)),
          totpKeyId: this.cipher.activeKeyId,
          totpEnabledAt: now,
          totpLastUsedStep: verification.step,
          status: 'ACTIVE',
          failedLoginCount: 0,
          lockoutLevel: 0,
          lockedUntil: null,
          lastLoginAt: now,
        },
      });
      await this.db.recoveryCode.deleteMany({ where: { userId: user.id } });
      await this.db.recoveryCode.createMany({
        data: recoveryCodes.map((c) => ({
          userId: user.id,
          codeHash: hashRecoveryCode(normalizeRecoveryCode(c)!),
        })),
      });
      const issued = await this.sessions.upgrade(session.id, 'FULL', { mfaVerified: true });
      const target = { type: 'User', id: user.id } as const;
      await this.audit.record({
        action: 'auth.totp.enrolled',
        outcome: 'SUCCESS',
        actorUserId: user.id,
        target,
        metadata: {},
      });
      await this.audit.record({
        action: 'auth.enrollment.completed',
        outcome: 'SUCCESS',
        actorUserId: user.id,
        target,
        metadata: { flow: user.status === 'INVITED' ? 'INVITE' : 'MFA_RESET' },
      });
      return { kind: 'ok' as const, issued, recoveryCodes };
    });

    if (outcome.kind === 'conflict')
      throw new DomainError('USER_STATE_CONFLICT', 'The authenticator setup was already confirmed');
    if (outcome.kind === 'exhausted')
      throw new DomainError('AUTH_MFA_ATTEMPTS_EXHAUSTED', 'Too many wrong codes; start again');
    if (outcome.kind === 'invalid')
      throw new DomainError('AUTH_INVALID_MFA_CODE', 'The code is not valid');
    return { issued: outcome.issued, recoveryCodes: outcome.recoveryCodes };
  }
}
