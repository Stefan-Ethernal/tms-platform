import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  AccessGuard,
  DenyAllPrincipalResolver,
  PrincipalResolver,
  SharedModule,
} from '@tms/domain/shared';
import { CoreModule, createEnvSchema } from '@tms/nest-bootstrap';
import type { z } from 'zod';

/** The kiosk API's environment: the shared variables, PORT defaulting to 3002. */
export const envSchema = createEnvSchema({ defaultPort: 3002 });
export type Env = z.infer<typeof envSchema>;

/** Root module; feature modules join `imports` next to CoreModule from phase 2 on. */
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot({ app: 'api-driver', env }),
        SharedModule.forRoot({ app: 'DRIVER' }),
      ],
      providers: [
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: PrincipalResolver, useClass: DenyAllPrincipalResolver },
      ],
    };
  }
}
