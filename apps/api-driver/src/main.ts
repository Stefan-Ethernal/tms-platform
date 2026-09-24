// Must stay the first import: Sentry initialises before Nest is loaded.
import './instrument';
import 'reflect-metadata';
import { bootstrapApi } from '@tms/nest-bootstrap';
import { AppModule, envSchema } from './app.module';

void bootstrapApi({ name: 'api-driver', envSchema, module: (env) => AppModule.forRoot(env) });
