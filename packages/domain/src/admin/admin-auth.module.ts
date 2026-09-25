import { type DynamicModule, Module } from '@nestjs/common';
import {
  AesGcmSecretCipher,
  Argon2idPasswordHasher,
  cryptoRandomSource,
  OtplibTotpProvider,
} from '@tms/auth-core';
import { AUTH_OPTIONS, type AdminAuthOptions } from './auth/options';
import { PASSWORD_HASHER, RANDOM_SOURCE, SECRET_CIPHER, TOTP_PROVIDER } from './auth/ports';
import { EnrollmentService } from './auth/enrollment/enrollment.service';
import { InviteService } from './auth/invites/invite.service';
import { SessionCookie } from './auth/sessions/session-cookie';
import { SessionService } from './auth/sessions/session.service';
import { StaffSessionResolver } from './auth/sessions/staff-session.resolver';
import { ActionTokenService } from './auth/tokens/action-token.service';
import { RoleAdminService } from './roles/role-admin.service';
import { UserAdminService } from './users/user-admin.service';

@Module({})
export class AdminAuthModule {
  static forRoot(options: AdminAuthOptions): DynamicModule {
    return {
      module: AdminAuthModule,
      global: true,
      providers: [
        { provide: AUTH_OPTIONS, useValue: options },
        { provide: RANDOM_SOURCE, useValue: cryptoRandomSource },
        {
          provide: SECRET_CIPHER,
          useFactory: () =>
            new AesGcmSecretCipher({
              keys: options.secrets.keyring,
              activeKeyId: options.secrets.activeKeyId,
            }),
        },
        {
          provide: PASSWORD_HASHER,
          useFactory: () => new Argon2idPasswordHasher({ pepper: options.passwordPepper }),
        },
        { provide: TOTP_PROVIDER, useValue: new OtplibTotpProvider() },
        SessionCookie,
        SessionService,
        StaffSessionResolver,
        ActionTokenService,
        InviteService,
        EnrollmentService,
        UserAdminService,
        RoleAdminService,
      ],
      exports: [
        AUTH_OPTIONS,
        SECRET_CIPHER,
        PASSWORD_HASHER,
        TOTP_PROVIDER,
        SessionCookie,
        SessionService,
        StaffSessionResolver,
        ActionTokenService,
        InviteService,
        EnrollmentService,
        UserAdminService,
        RoleAdminService,
      ],
    };
  }
}
