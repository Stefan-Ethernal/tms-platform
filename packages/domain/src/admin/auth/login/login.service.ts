import { Inject, Injectable } from '@nestjs/common';
import {
  hashRecoveryCode,
  MFA_MAX_ATTEMPTS,
  normalizeRecoveryCode,
  type PasswordHasher,
  type SecretCipher,
  type TotpProvider,
} from '@tms/auth-core';
import { DomainError, type LoginFailureReason, type MfaRequest } from '@tms/contracts';
import {
  type AppTransactionHost,
  AuditService,
  Clock,
  type Principal,
  TransactionHost,
  UnitOfWork,
} from '../../../shared';
import { totpAad } from '../credentials';
import { PASSWORD_HASHER, SECRET_CIPHER, TOTP_PROVIDER } from '../ports';
import { type IssuedSession, SessionService } from '../sessions/session.service';
import { AccountLockService } from './account-lock.service';

export const invalidCredentials = (): DomainError =>
  new DomainError('AUTH_INVALID_CREDENTIALS', 'Invalid email or password');
/** 423 — only for callers that already proved the account (PRE_MFA or FULL session), never on a public route (D1). */
export const accountLocked = (retryAfterSeconds: number): DomainError =>
  new DomainError('AUTH_ACCOUNT_LOCKED', 'Account temporarily locked', { retryAfterSeconds });

type PasswordOutcome =
  { kind: 'ok'; issued: IssuedSession } | { kind: 'invalid' } | { kind: 'mfaResetPending' };

type PasswordFailureReason =
  'INVALID_CREDENTIALS' | 'ACCOUNT_NOT_ACTIVE' | 'ACCOUNT_LOCKED' | 'MFA_RESET_PENDING';

type MfaOutcome =
  | { kind: 'ok'; issued: IssuedSession }
  | { kind: 'invalid' }
  | { kind: 'exhausted' }
  | { kind: 'locked'; retryAfterSeconds: number };

@Injectable()
export class LoginService {
  private dummyHash: Promise<string> | undefined;

  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly uow: UnitOfWork,
    private readonly sessions: SessionService,
    private readonly locks: AccountLockService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
    @Inject(TOTP_PROVIDER) private readonly totp: TotpProvider,
  ) {}

  /** A real hash to verify against when the account does not exist (equal work, no enumeration). */
  private dummy(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('timing-equalisation-only-not-a-password');
    return this.dummyHash;
  }

  async passwordStep(email: string, password: string): Promise<IssuedSession> {
    const user = await this.txHost.tx.user.findUnique({
      where: { email },
      select: {
        id: true,
        kind: true,
        passwordHash: true,
        failedLoginCount: true,
        lockoutLevel: true,
        lockedUntil: true,
      },
    });
    const candidate =
      user && user.kind === 'STAFF' && user.passwordHash
        ? { ...user, passwordHash: user.passwordHash }
        : null;
    // D1: a locked account's password is never evaluated; the dummy hash keeps the argon2 work equal on every branch.
    const lockedBefore = candidate ? this.locks.isLockedNow(candidate) : false;
    const hash = candidate && !lockedBefore ? candidate.passwordHash : await this.dummy();
    const matches = await this.hasher.verify(hash, password);
    const verified = matches && candidate !== null && !lockedBefore; // a match against the dummy never counts

    if (!candidate) {
      await this.audit.record({
        action: 'auth.login.failure',
        outcome: 'FAILURE',
        ...(user ? { target: { type: 'User', id: user.id } } : {}),
        metadata: {
          method: 'PASSWORD',
          reason: !user
            ? 'UNKNOWN_ACCOUNT'
            : user.kind !== 'STAFF'
              ? 'NOT_STAFF'
              : 'ACCOUNT_NOT_ACTIVE',
        },
      });
      throw invalidCredentials();
    }

    const outcome = await this.uow.run(async (): Promise<PasswordOutcome> => {
      const account = await this.locks.lock(candidate.id);
      const fail = (reason: PasswordFailureReason) =>
        this.audit.record({
          action: 'auth.login.failure',
          outcome: 'FAILURE',
          target: { type: 'User', id: candidate.id },
          metadata: { method: 'PASSWORD', reason },
        });
      // D1: locked before the hash (password not evaluated) or since (a parallel lock wins) → generic 401, not counted
      if (lockedBefore || account.isLocked) {
        await fail('ACCOUNT_LOCKED');
        return { kind: 'invalid' };
      }
      if (!verified) {
        await this.locks.fail(account);
        await fail('INVALID_CREDENTIALS');
        return { kind: 'invalid' };
      }
      await this.locks.keep(account); // Review Focus 1: a correct password alone never resets the counter
      if (account.status !== 'ACTIVE') {
        await fail('ACCOUNT_NOT_ACTIVE');
        return { kind: 'invalid' };
      }
      if (!account.totpEnabledAt) {
        await fail('MFA_RESET_PENDING');
        return { kind: 'mfaResetPending' };
      }
      const issued = await this.sessions.create(candidate.id, 'PRE_MFA', { mfaVerified: false });
      await this.audit.record({
        action: 'auth.login.success',
        outcome: 'SUCCESS',
        actorUserId: candidate.id,
        target: { type: 'User', id: candidate.id },
        metadata: { method: 'PASSWORD' },
      });
      return { kind: 'ok', issued };
    });

    switch (outcome.kind) {
      case 'ok':
        return outcome.issued;
      case 'mfaResetPending':
        throw new DomainError(
          'AUTH_MFA_RESET_PENDING',
          'Your authenticator was reset; use the link in your email',
        );
      default:
        throw invalidCredentials();
    }
  }

  async mfaStep(principal: Principal, input: MfaRequest): Promise<IssuedSession> {
    const method = 'totpCode' in input ? 'TOTP' : 'RECOVERY_CODE';
    const user = await this.txHost.tx.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: { id: true, totpSecretEnc: true, totpLastUsedStep: true },
    });
    let step: number | null = null;
    let recoveryHash: string | null = null;
    if ('totpCode' in input) {
      if (user.totpSecretEnc) {
        const secret = this.cipher.decrypt(user.totpSecretEnc, totpAad(user.id));
        const v = await this.totp.verify({
          secret,
          code: input.totpCode,
          now: this.clock.now(),
          lastUsedStep: user.totpLastUsedStep,
        });
        step = v.ok ? v.step : null;
      }
    } else {
      const normalized = normalizeRecoveryCode(input.recoveryCode);
      recoveryHash = normalized ? hashRecoveryCode(normalized) : null;
    }

    const outcome = await this.uow.run(async (): Promise<MfaOutcome> => {
      const account = await this.locks.lock(user.id);
      const failure = (reason: LoginFailureReason) =>
        this.audit.record({
          action: 'auth.login.failure',
          outcome: 'FAILURE',
          target: { type: 'User', id: user.id },
          metadata: { method, reason },
        });
      if (account.status !== 'ACTIVE') {
        // blocked or deactivated after the guard: its sessions are gone, so never reach upgrade() (P2025 → 500)
        await failure('ACCOUNT_NOT_ACTIVE');
        return { kind: 'invalid' };
      }
      if (account.isLocked) {
        await this.sessions.revokePreMfaSessions(user.id);
        await failure('ACCOUNT_LOCKED');
        return { kind: 'locked', retryAfterSeconds: account.remainingSeconds };
      }
      let success = false;
      let reason: 'INVALID_CODE' | 'CODE_REPLAYED' = 'INVALID_CODE';
      if (step !== null) {
        const { count } = await this.txHost.tx.user.updateMany({
          where: {
            id: user.id,
            OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }],
          },
          data: { totpLastUsedStep: step },
        });
        success = count === 1;
        if (!success) reason = 'CODE_REPLAYED';
      } else if (recoveryHash) {
        const { count } = await this.txHost.tx.recoveryCode.updateMany({
          where: { userId: user.id, codeHash: recoveryHash, usedAt: null },
          data: { usedAt: account.now },
        });
        success = count === 1;
      }
      if (!success) {
        // Order matters: `locks.fail` may revoke every PRE_MFA session of this account (a lock
        // starting now), including this one — record the pre-session's own attempt count first.
        const attempts = await this.sessions.recordMfaFailure(principal.sessionId);
        const { lockedNow } = await this.locks.fail(account);
        await failure(
          lockedNow
            ? 'ACCOUNT_LOCKED'
            : attempts >= MFA_MAX_ATTEMPTS
              ? 'TOO_MANY_MFA_ATTEMPTS'
              : reason,
        );
        if (lockedNow) {
          const relocked = await this.locks.lock(user.id);
          return { kind: 'locked', retryAfterSeconds: relocked.remainingSeconds };
        }
        if (attempts >= MFA_MAX_ATTEMPTS) {
          await this.sessions.destroy(principal.sessionId);
          return { kind: 'exhausted' };
        }
        return { kind: 'invalid' };
      }
      await this.locks.succeed(account, 'MFA_SUCCESS');
      await this.txHost.tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: account.now },
      });
      const issued = await this.sessions.upgrade(principal.sessionId, 'FULL', {
        mfaVerified: true,
      });
      await this.audit.record({
        action: 'auth.login.success',
        outcome: 'SUCCESS',
        actorUserId: user.id,
        target: { type: 'User', id: user.id },
        metadata: { method },
      });
      return { kind: 'ok', issued };
    });

    switch (outcome.kind) {
      case 'ok':
        return outcome.issued;
      case 'locked':
        throw accountLocked(outcome.retryAfterSeconds);
      case 'exhausted':
        throw new DomainError('AUTH_MFA_ATTEMPTS_EXHAUSTED', 'Too many wrong codes; sign in again');
      default:
        throw new DomainError('AUTH_INVALID_MFA_CODE', 'The code is not valid');
    }
  }
}
