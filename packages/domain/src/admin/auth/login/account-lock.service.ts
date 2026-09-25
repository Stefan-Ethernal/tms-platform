import { Inject, Injectable } from '@nestjs/common';
import {
  isLocked,
  lockRemainingSeconds,
  type LockoutState,
  type LockoutSuccessReason,
  normalizeLockout,
  registerFailure,
  registerSuccess,
} from '@tms/auth-core';
import type { UserStatus } from '@tms/contracts';
import { type AppTransactionHost, AuditService, Clock, TransactionHost } from '../../../shared';
import { AUTH_OPTIONS, type AdminAuthOptions } from '../options';
import { SessionService } from '../sessions/session.service';

/** The lockout columns of a `User` row. */
export interface LockColumns {
  failedLoginCount: number;
  lockoutLevel: number;
  lockedUntil: Date | null;
}

const toState = (c: LockColumns): LockoutState => ({
  failedCount: c.failedLoginCount,
  level: c.lockoutLevel,
  lockedUntil: c.lockedUntil,
});

export interface LockedAccount {
  userId: string;
  now: Date;
  state: LockoutState;
  status: UserStatus;
  totpEnabledAt: Date | null;
  isLocked: boolean;
  remainingSeconds: number;
}

interface LockRow extends LockColumns {
  status: UserStatus;
  totpEnabledAt: Date | null;
}

/** Serialises every credential check of one account (password, TOTP, recovery code). */
@Injectable()
export class AccountLockService {
  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly clock: Clock,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(AUTH_OPTIONS) private readonly options: AdminAuthOptions,
  ) {}

  /**
   * FOR NO KEY UPDATE: the lockout columns are not keys, and the weaker lock does not block the
   * FOR KEY SHARE that inserting a Session, ActionToken or AuditLog row referencing the user takes
   * (same lock strength as the admin actions, deviation 16).
   */
  async lock(userId: string): Promise<LockedAccount> {
    if (!this.txHost.isTransactionActive())
      throw new Error('AccountLockService.lock needs an active transaction');
    const rows = await this.txHost.tx.$queryRaw<LockRow[]>`
      SELECT "failedLoginCount", "lockoutLevel", "lockedUntil", "status", "totpEnabledAt"
      FROM "User" WHERE "id" = ${userId}::uuid FOR NO KEY UPDATE`;
    const row = rows[0];
    if (!row) throw new Error(`user ${userId} vanished during a credential check`);
    const now = this.clock.now();
    const state = normalizeLockout(toState(row), now);
    return {
      userId,
      now,
      state,
      status: row.status,
      totpEnabledAt: row.totpEnabledAt,
      isLocked: isLocked(state, now),
      remainingSeconds: lockRemainingSeconds(state, now),
    };
  }

  /**
   * Lock check on a row read without the lock (D1): a public credential route calls it before the
   * argon2 step to decide whether the password is evaluated at all. `lock()` re-checks under the lock.
   */
  isLockedNow(columns: LockColumns): boolean {
    const now = this.clock.now();
    return isLocked(normalizeLockout(toState(columns), now), now);
  }

  async fail(account: LockedAccount): Promise<{ lockedNow: boolean }> {
    const result = registerFailure(account.state, account.now, this.options.lockout);
    await this.persist(account.userId, result.state);
    if (result.lockedNow && result.state.lockedUntil) {
      await this.audit.record({
        action: 'auth.lockout.applied',
        outcome: 'SUCCESS',
        target: { type: 'User', id: account.userId },
        metadata: {
          failedAttempts: result.state.failedCount,
          lockedUntil: result.state.lockedUntil.toISOString(),
          level: result.state.level,
        },
      });
      await this.sessions.revokePreMfaSessions(account.userId);
    }
    return { lockedNow: result.lockedNow };
  }

  /**
   * `reason` names which of the three legitimate triggers cleared the counter (never a correct
   * password alone — auth-core's `registerSuccess` requires it; reused by Tasks 17-19, 22).
   */
  succeed(account: LockedAccount, reason: LockoutSuccessReason): Promise<void> {
    return this.persist(account.userId, registerSuccess(account.state, reason));
  }

  /** Writes the normalised state (an expired lock clears the counter, keeps the level). */
  keep(account: LockedAccount): Promise<void> {
    return this.persist(account.userId, account.state);
  }

  private async persist(userId: string, s: LockoutState): Promise<void> {
    await this.txHost.tx.user.update({
      where: { id: userId },
      data: { failedLoginCount: s.failedCount, lockoutLevel: s.level, lockedUntil: s.lockedUntil },
    });
  }
}
