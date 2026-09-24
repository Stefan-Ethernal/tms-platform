import type { ServerResponse } from 'node:http';
import { type DynamicModule, Global, Module } from '@nestjs/common';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { ClsModule } from 'nestjs-cls';
import type { AuditApp } from '@tms/contracts';
import { PrismaService } from '@tms/db/nest';
import { resolveRequestId } from '@tms/logger';
import { AUDIT_APP, AuditService } from './audit.service';
import { Clock, SystemClock } from './clock';
import { type IncomingRequest, REQUEST_CONTEXT_KEY, requestContextFrom } from './request-context';

export interface SharedModuleOptions {
  // SYSTEM is written directly by the permission sync and the seed, never by an app's own
  // SharedModule.forRoot() call.
  readonly app: Exclude<AuditApp, 'SYSTEM'>;
}

@Global()
@Module({})
export class SharedModule {
  static forRoot({ app }: SharedModuleOptions): DynamicModule {
    return {
      module: SharedModule,
      imports: [
        ClsModule.forRoot({
          global: true,
          middleware: {
            mount: true,
            generateId: true,
            idGenerator: (req: IncomingRequest) => resolveRequestId(req),
            setup: (cls, req: IncomingRequest, res: ServerResponse) => {
              // Also sets X-Request-Id: pino-http skips its genReqId once req.id exists, so the
              // echo must not depend on which of the two middlewares Nest runs first.
              resolveRequestId(req, res);
              cls.set(REQUEST_CONTEXT_KEY, requestContextFrom(cls.getId(), req));
            },
          },
          plugins: [
            new ClsPluginTransactional({
              adapter: new TransactionalAdapterPrisma<PrismaService>({
                prismaInjectionToken: PrismaService,
                sqlFlavor: 'postgresql',
              }),
            }),
          ],
        }),
      ],
      providers: [
        { provide: AUDIT_APP, useValue: app },
        { provide: Clock, useClass: SystemClock },
        AuditService,
      ],
      exports: [AuditService, Clock],
    };
  }
}
