import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminAuthModule, StaffSessionResolver } from '@tms/domain/admin';
import { AccessGuard, PrincipalResolver, SharedModule } from '@tms/domain/shared';
import { CoreModule, ORIGIN_ALLOWLIST, OriginGuard } from '@tms/nest-bootstrap';
import { AuthHttpModule } from './auth/auth-http.module';
import type { Env } from './env';

/** Root module; feature modules join `imports` next to CoreModule from phase 2 on. */
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot({ app: 'api-admin', env }),
        SharedModule.forRoot({ app: 'ADMIN' }),
        AdminAuthModule.forRoot({
          session: {
            idleSeconds: env.SESSION_IDLE_MINUTES * 60,
            fullAbsoluteSeconds: env.SESSION_ABSOLUTE_HOURS * 3600,
            cookieSecure: env.SESSION_COOKIE_SECURE,
          },
        }),
        AuthHttpModule,
      ],
      providers: [
        { provide: ORIGIN_ALLOWLIST, useValue: env.ADMIN_WEB_ORIGINS },
        { provide: APP_GUARD, useClass: OriginGuard },
        // Task 16 inserts { provide: APP_GUARD, useClass: ThrottlerGuard } here.
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: PrincipalResolver, useExisting: StaffSessionResolver },
      ],
    };
  }
}
