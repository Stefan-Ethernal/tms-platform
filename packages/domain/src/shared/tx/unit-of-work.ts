import { Inject, Injectable, Logger } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { ClsService } from 'nestjs-cls';
import type { AppTransactionHost } from '../transaction';

type Effect = () => Promise<unknown>;
const EFFECTS = Symbol('tms:after-commit-effects');

export class AfterCommitError extends Error {
  constructor(readonly errors: unknown[]) {
    super(`${errors.length} after-commit effect(s) failed`);
    this.name = 'AfterCommitError';
  }
}

/** A transaction plus side effects that run only after the outermost commit (ADR 0006: events are fire-and-forget). */
@Injectable()
export class UnitOfWork {
  private readonly logger = new Logger('UnitOfWork');

  constructor(
    private readonly cls: ClsService,
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
  ) {}

  async run<T>(fn: () => Promise<T>, options: { awaitEffects?: boolean } = {}): Promise<T> {
    if (this.cls.isActive() && this.cls.get<Effect[] | undefined>(EFFECTS)) {
      // Joined: the effects run after the outer commit, and the outer caller decides whether they are awaited.
      if (options.awaitEffects)
        throw new Error('UnitOfWork.run: awaitEffects is only allowed on the outermost unit');
      return fn();
    }
    if (this.txHost.isTransactionActive())
      throw new Error('UnitOfWork.run cannot start inside a transaction it does not own');
    return this.cls.run({ ifNested: 'inherit' }, async () => {
      const effects: Effect[] = [];
      this.cls.set(EFFECTS, effects);
      const result = await this.txHost.withTransaction(fn);
      this.cls.set(EFFECTS, undefined);
      await this.flush(effects, options.awaitEffects ?? false);
      return result;
    });
  }

  afterCommit(effect: Effect): void {
    const effects = this.cls.isActive() ? this.cls.get<Effect[] | undefined>(EFFECTS) : undefined;
    if (effects) {
      effects.push(effect);
      return;
    }
    if (this.txHost.isTransactionActive())
      throw new Error('afterCommit needs UnitOfWork.run around the transaction');
    void this.flush([effect], false);
  }

  private async flush(effects: Effect[], wait: boolean): Promise<void> {
    if (effects.length === 0) return;
    const failures = Promise.allSettled(effects.map((effect) => effect())).then((results) =>
      results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => r.reason as unknown),
    );
    if (wait) {
      const errors = await failures;
      if (errors.length) throw new AfterCommitError(errors);
      return;
    }
    void failures.then((errors) => {
      for (const error of errors)
        this.logger.error(
          `after-commit effect failed (${error instanceof Error ? error.name : 'unknown'})`,
        );
    });
  }
}
