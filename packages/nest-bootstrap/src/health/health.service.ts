import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { scrubString } from '@tms/contracts/security';
import { PrismaService } from '@tms/db/nest';
import { InjectPinoLogger, PinoLogger } from '@tms/logger';
import { HEALTH_OPTIONS, type HealthModuleOptions } from './health.options';

export const DEGRADED_LOG_MESSAGE = 'health degraded: database ping failed';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indicators: HealthIndicatorService,
    @Inject(HEALTH_OPTIONS) private readonly options: HealthModuleOptions,
    @InjectPinoLogger(HealthService.name) private readonly logger: PinoLogger,
  ) {}

  /** `up` when `SELECT 1` answers within dbTimeoutMs; `down` otherwise. Never throws. */
  async checkDatabase(): Promise<HealthIndicatorResult<'db'>> {
    const indicator = this.indicators.check('db');
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, this.options.dbTimeoutMs);
      return indicator.up();
    } catch (error) {
      // The reason only: never the connection string, never the stack.
      this.logger.warn({ reason: reasonOf(error) }, DEGRADED_LOG_MESSAGE);
      return indicator.down();
    }
  }
}

async function withTimeout<T>(work: PromiseLike<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`database ping timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return scrubString(message).slice(0, 500);
}
