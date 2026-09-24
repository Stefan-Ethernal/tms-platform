import type { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import type { PrismaService } from '@tms/db/nest';

/**
 * The transaction host of every domain service. A type alias is emitted as `Object` in decorator
 * metadata, so constructor parameters of this type need `@Inject(TransactionHost)`.
 */
export type AppTransactionHost = TransactionHost<TransactionalAdapterPrisma<PrismaService>>;
