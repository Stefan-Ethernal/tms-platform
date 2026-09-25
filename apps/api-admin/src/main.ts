// Must stay the first import: Sentry initialises before Nest is loaded.
import './instrument';
import 'reflect-metadata';
import { bootstrapApi } from '@tms/nest-bootstrap';
import { AppModule } from './app.module';
import { envSchema } from './env';

void bootstrapApi({ name: 'api-admin', envSchema, module: (env) => AppModule.forRoot(env) });
