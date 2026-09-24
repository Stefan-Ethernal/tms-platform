// The Sentry setup import must stay the first import of this file once it exists.
import 'reflect-metadata';
import { bootstrapApi } from '@tms/nest-bootstrap';
import { AppModule, envSchema } from './app.module';

void bootstrapApi({ name: 'api-admin', envSchema, module: (env) => AppModule.forRoot(env) });
