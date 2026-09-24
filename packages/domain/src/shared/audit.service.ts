import { Inject, Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { ClsService } from 'nestjs-cls';
import {
  type AuditAction,
  type AuditApp,
  type AuditMetadata,
  type AuditOutcome,
  type AuditTargetType,
  parseAuditMetadata,
} from '@tms/contracts';
import { Clock } from './clock';
import { REQUEST_CONTEXT_KEY, type RequestContext } from './request-context';
import type { AppTransactionHost } from './transaction';

export const AUDIT_APP = 'tms:audit-app';

export interface AuditRecordInput<A extends AuditAction> {
  readonly action: A;
  readonly outcome: AuditOutcome;
  readonly actorUserId?: string | null | undefined;
  readonly target?: { readonly type: AuditTargetType; readonly id: string } | undefined;
  readonly metadata?: AuditMetadata<A> | undefined;
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly cls: ClsService,
    private readonly clock: Clock,
    @Inject(AUDIT_APP) private readonly app: AuditApp,
  ) {}

  /**
   * Writes one audit row through `txHost.tx`: inside `@Transactional()` that is the caller's
   * transaction, so a rollback removes the row too; outside one it autocommits. Invalid metadata
   * throws `AuditMetadataError` before anything is written. No try/catch: a failed audit write
   * fails the caller (fail-closed).
   */
  async record<A extends AuditAction>(input: AuditRecordInput<A>): Promise<void> {
    const metadata = parseAuditMetadata(input.action, input.metadata);
    const context = this.cls.isActive()
      ? this.cls.get<RequestContext | undefined>(REQUEST_CONTEXT_KEY)
      : undefined;
    await this.txHost.tx.auditLog.create({
      data: {
        at: this.clock.now(),
        app: this.app,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        targetType: input.target?.type ?? null,
        targetId: input.target?.id ?? null,
        outcome: input.outcome,
        ip: context?.ip ?? null,
        userAgent: context?.userAgent ?? null,
        metadata,
      },
    });
  }
}
