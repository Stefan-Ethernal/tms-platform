import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { parseKeyring } from '@tms/auth-core';
import { AdminAuthModule, StaffSessionResolver } from '@tms/domain/admin';
import { AccessGuard, MailModule, PrincipalResolver, SharedModule } from '@tms/domain/shared';
import { CoreModule, ORIGIN_ALLOWLIST, OriginGuard } from '@tms/nest-bootstrap';
import { AdminHttpModule } from './admin/admin-http.module';
import { AuthHttpModule } from './auth/auth-http.module';
import type { Env } from './env';

/** Root module; feature modules join `imports` next to CoreModule from phase 2 on. */
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    const webBaseUrl = env.ADMIN_WEB_URL.replace(/\/$/, '');
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot({ app: 'api-admin', env }),
        SharedModule.forRoot({ app: 'ADMIN' }),
        MailModule.forRoot({ smtpUrl: env.SMTP_URL, from: env.MAIL_FROM }),
        AdminAuthModule.forRoot({
          session: {
            idleSeconds: env.SESSION_IDLE_MINUTES * 60,
            fullAbsoluteSeconds: env.SESSION_ABSOLUTE_HOURS * 3600,
            cookieSecure: env.SESSION_COOKIE_SECURE,
          },
          invite: { ttlSeconds: env.INVITE_TTL_HOURS * 3600 },
          webBaseUrl,
          secrets: {
            keyring: parseKeyring(env.SECRETS_ENC_KEYS),
            activeKeyId: env.SECRETS_ENC_ACTIVE_KEY_ID,
          },
          passwordPepper: Buffer.from(env.PASSWORD_PEPPER, 'base64'),
          totpIssuer: env.TOTP_ISSUER,
        }),
        AuthHttpModule,
        AdminHttpModule,
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
