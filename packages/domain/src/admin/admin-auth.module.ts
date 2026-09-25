import { type DynamicModule, Module } from '@nestjs/common';
import { cryptoRandomSource } from '@tms/auth-core';
import { AUTH_OPTIONS, type AdminAuthOptions } from './auth/options';
import { RANDOM_SOURCE } from './auth/ports';
import { SessionCookie } from './auth/sessions/session-cookie';
import { SessionService } from './auth/sessions/session.service';
import { StaffSessionResolver } from './auth/sessions/staff-session.resolver';

@Module({})
export class AdminAuthModule {
  static forRoot(options: AdminAuthOptions): DynamicModule {
    return {
      module: AdminAuthModule,
      global: true,
      providers: [
        { provide: AUTH_OPTIONS, useValue: options },
        { provide: RANDOM_SOURCE, useValue: cryptoRandomSource },
        SessionCookie,
        SessionService,
        StaffSessionResolver,
      ],
      exports: [AUTH_OPTIONS, SessionCookie, SessionService, StaffSessionResolver],
    };
  }
}
