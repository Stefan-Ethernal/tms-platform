import { type DynamicModule, Module } from '@nestjs/common';
import { CoreModule, createEnvSchema } from '@tms/nest-bootstrap';
import type { z } from 'zod';

/** The back-office API's environment: the shared variables, PORT defaulting to 3001. */
export const envSchema = createEnvSchema({ defaultPort: 3001 });
export type Env = z.infer<typeof envSchema>;

/** Root module; feature modules join `imports` next to CoreModule from phase 2 on. */
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return { module: AppModule, imports: [CoreModule.forRoot({ app: 'api-admin', env })] };
  }
}
