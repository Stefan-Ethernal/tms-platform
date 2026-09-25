import { Inject, Injectable } from '@nestjs/common';
import { generateToken, hashToken, type RandomSource } from '@tms/auth-core';
import type { ActionTokenType } from '@tms/contracts';
import { type AppTransactionHost, Clock, TransactionHost } from '../../../shared';
import { RANDOM_SOURCE } from '../ports';

@Injectable()
export class ActionTokenService {
  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly clock: Clock,
    @Inject(RANDOM_SOURCE) private readonly random: RandomSource,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  async issue(
    userId: string,
    type: ActionTokenType,
    ttlSeconds: number,
    createdById: string | null,
  ) {
    const now = this.clock.now();
    await this.db.actionToken.deleteMany({ where: { userId, type, usedAt: null } });
    const token = generateToken(this.random);
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    await this.db.actionToken.create({
      data: { userId, type, tokenHash: hashToken(token), expiresAt, createdById },
    });
    return { token, expiresAt };
  }

  /** Single use: one conditional update decides the winner of concurrent requests. */
  async consume(token: string, type: ActionTokenType): Promise<{ userId: string } | null> {
    const now = this.clock.now();
    const tokenHash = hashToken(token);
    const { count } = await this.db.actionToken.updateMany({
      where: { tokenHash, type, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (count !== 1) return null;
    const row = await this.db.actionToken.findFirstOrThrow({
      where: { tokenHash, type },
      select: { userId: true },
    });
    return { userId: row.userId };
  }

  async peek(token: string, type: ActionTokenType): Promise<{ userId: string } | null> {
    const row = await this.db.actionToken.findFirst({
      where: {
        tokenHash: hashToken(token),
        type,
        usedAt: null,
        expiresAt: { gt: this.clock.now() },
      },
      select: { userId: true },
    });
    return row ?? null;
  }

  async findPending(userId: string, type: ActionTokenType): Promise<{ expiresAt: Date } | null> {
    return this.db.actionToken.findFirst({
      where: { userId, type, usedAt: null, expiresAt: { gt: this.clock.now() } },
      select: { expiresAt: true },
      orderBy: { expiresAt: 'desc' },
    });
  }

  async revokeUnusedTokens(userId: string): Promise<number> {
    return (await this.db.actionToken.deleteMany({ where: { userId, usedAt: null } })).count;
  }
}
