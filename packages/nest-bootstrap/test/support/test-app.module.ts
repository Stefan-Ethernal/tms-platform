import { type DynamicModule, Module } from '@nestjs/common';
import { type BaseEnv, CoreModule } from '../../src';

/** Stand-in for an app's AppModule: only the shared core, no controllers. */
@Module({})
export class TestAppModule {
  static forRoot(env: BaseEnv): DynamicModule {
    return { module: TestAppModule, imports: [CoreModule.forRoot({ app: 'api-admin', env })] };
  }
}
