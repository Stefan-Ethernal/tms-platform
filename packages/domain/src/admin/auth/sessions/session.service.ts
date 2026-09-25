import { Inject, Injectable } from '@nestjs/common';
import {
  absoluteExpiry,
  DEFAULT_SESSION_EXPIRY,
  generateToken,
  hashToken,
  type RandomSource,
  type SessionExpiryConfig,
} from '@tms/auth-core';
import type { SessionScope, SessionStateResponse } from '@tms/contracts';
import type { Prisma } from '@tms/db';
import {
  type AppTransactionHost,
  AuditService,
  Clock,
  ClsService,
  type Principal,
  REQUEST_CONTEXT_KEY,
  type RequestContext,
  TransactionHost,
} from '../../../shared';
import { AUTH_OPTIONS, type AdminAuthOptions } from '../options';
import { RANDOM_SOURCE } from '../ports';

export interface IssuedSession {
  token: string;
  sessionId: string;
  userId: string;
  scope: SessionScope;
  expiresAt: Date;
}

const TOUCH_INTERVAL_MS = 60_000;

/** Args of `findByToken`'s query, named once so its result type stays portable across the package boundary (TS2883). */
const SESSION_WITH_USER = {
  include: {
    user: {
      select: {
        id: true,
        kind: true,
        status: true,
        totpEnabledAt: true,
        role: { select: { permissions: { select: { permissionCode: true } } } },
      },
    },
  },
} satisfies Prisma.SessionDefaultArgs;

export type SessionWithUser = Prisma.SessionGetPayload<typeof SESSION_WITH_USER>;

@Injectable()
export class SessionService {
  readonly expiry: SessionExpiryConfig;

  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly clock: Clock,
    private readonly cls: ClsService,
    private readonly audit: AuditService,
    @Inject(RANDOM_SOURCE) private readonly random: RandomSource,
    @Inject(AUTH_OPTIONS) options: AdminAuthOptions,
  ) {
    this.expiry = {
      ...DEFAULT_SESSION_EXPIRY,
      idleSeconds: options.session.idleSeconds,
      fullAbsoluteSeconds: options.session.fullAbsoluteSeconds,
    };
  }

  private get db() {
    return this.txHost.tx;
  }

  /** Phase 1's CLS middleware stores the request context; CLIs and tests without a request have none. */
  private get context(): RequestContext | undefined {
    return this.cls.isActive()
      ? this.cls.get<RequestContext | undefined>(REQUEST_CONTEXT_KEY)
      : undefined;
  }

  async create(
    userId: string,
    scope: SessionScope,
    opts: { mfaVerified: boolean },
  ): Promise<IssuedSession> {
    const now = this.clock.now();
    const token = generateToken(this.random);
    const context = this.context;
    const session = await this.db.session.create({
      data: {
        userId,
        scope,
        tokenHash: hashToken(token),
        mfaVerifiedAt: opts.mfaVerified ? now : null,
        mfaAttempts: 0,
        expiresAt: absoluteExpiry(scope, now, this.expiry),
        lastSeenAt: now,
        ip: context?.ip ?? null,
        userAgent: context?.userAgent ?? null, // already cut to USER_AGENT_MAX_LENGTH by phase 1
      },
    });
    return {
      token,
      sessionId: session.id,
      userId: session.userId,
      scope,
      expiresAt: session.expiresAt,
    };
  }

  /** Scope change on the same row (D4) with a new token hash (no session fixation). */
  async upgrade(
    sessionId: string,
    scope: SessionScope,
    opts: { mfaVerified: boolean },
  ): Promise<IssuedSession> {
    const now = this.clock.now();
    const token = generateToken(this.random);
    const session = await this.db.session.update({
      where: { id: sessionId },
      data: {
        scope,
        tokenHash: hashToken(token),
        totpPendingSecretEnc: null,
        mfaAttempts: 0,
        ...(opts.mfaVerified ? { mfaVerifiedAt: now } : {}),
        expiresAt: absoluteExpiry(scope, now, this.expiry),
        lastSeenAt: now,
      },
    });
    return {
      token,
      sessionId: session.id,
      userId: session.userId,
      scope,
      expiresAt: session.expiresAt,
    };
  }

  findByToken(token: string): Promise<SessionWithUser | null> {
    return this.db.session.findUnique({
      where: { tokenHash: hashToken(token) },
      ...SESSION_WITH_USER,
    });
  }

  async touch(sessionId: string, now: Date): Promise<void> {
    await this.db.session.updateMany({
      where: { id: sessionId, lastSeenAt: { lt: new Date(now.getTime() - TOUCH_INTERVAL_MS) } },
      data: { lastSeenAt: now },
    });
  }

  async destroy(sessionId: string): Promise<void> {
    await this.db.session.deleteMany({ where: { id: sessionId } });
  }

  async revokeAllSessions(userId: string): Promise<number> {
    return (await this.db.session.deleteMany({ where: { userId } })).count;
  }

  async revokePreMfaSessions(userId: string): Promise<number> {
    return (await this.db.session.deleteMany({ where: { userId, scope: 'PRE_MFA' } })).count;
  }

  async recordMfaFailure(sessionId: string): Promise<number> {
    const s = await this.db.session.update({
      where: { id: sessionId },
      data: { mfaAttempts: { increment: 1 } },
      select: { mfaAttempts: true },
    });
    return s.mfaAttempts;
  }

  async markMfaVerified(sessionId: string): Promise<void> {
    await this.db.session.update({
      where: { id: sessionId },
      data: { mfaVerifiedAt: this.clock.now() },
    });
  }

  async describe(principal: Pick<Principal, 'userId' | 'scope'>): Promise<SessionStateResponse> {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: { id: true, email: true, firstName: true, lastName: true, passwordHash: true },
    });
    const next =
      principal.scope === 'FULL'
        ? 'NONE'
        : principal.scope === 'PRE_MFA'
          ? 'VERIFY_MFA'
          : user.passwordHash
            ? 'ENROLL_TOTP'
            : 'SET_PASSWORD';
    return {
      scope: principal.scope,
      next,
      user: {
        id: user.id,
        email: user.email ?? '',
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }

  /** Delete and audit in one transaction (CLAUDE.md: audit rows are written inside the caller's transaction). */
  logout(principal: Principal): Promise<void> {
    return this.txHost.withTransaction(async () => {
      const { count } = await this.db.session.deleteMany({ where: { id: principal.sessionId } });
      await this.audit.record({
        action: 'auth.session.revoked',
        outcome: 'SUCCESS',
        actorUserId: principal.userId,
        metadata: { reason: 'LOGOUT', sessionCount: count },
      });
    });
  }
}
