import type { DynamicModule, INestApplication, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { z } from 'zod';
import { configureApp } from './app';
import type { ApiName } from './core.module';
import { type BaseEnv, listenHost, loadEnv } from './env';

export interface BootstrapOptions<E extends BaseEnv> {
  name: ApiName;
  envSchema: z.ZodType<E>;
  /** Builds the root module from the parsed environment, e.g. `(env) => AppModule.forRoot(env)`. */
  module: (env: E) => Type<unknown> | DynamicModule;
  /** Defaults to `process.env`. */
  source?: NodeJS.ProcessEnv;
  /** Defaults to `process.stderr`. */
  stderr?: { write(message: string): unknown };
}

/**
 * The whole main.ts of an API. An invalid environment is reported in one stderr line with exit
 * code 1 and resolves `undefined` instead of throwing: `void bootstrapApi(...)` would otherwise turn
 * it into an unhandled rejection that prints the message again with a stack trace.
 */
export async function bootstrapApi<E extends BaseEnv>({
  name,
  envSchema,
  module,
  source = process.env,
  stderr = process.stderr,
}: BootstrapOptions<E>): Promise<INestApplication | undefined> {
  let env: E;
  try {
    env = loadEnv(envSchema, source);
  } catch (error) {
    stderr.write(`${name}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return undefined;
  }
  const app = await NestFactory.create(module(env), { bufferLogs: true });
  configureApp(app);
  await app.listen(env.PORT, listenHost(env));
  return app;
}
