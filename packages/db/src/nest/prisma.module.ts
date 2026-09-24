import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { CreatePrismaClientOptions } from '../index';
import { PrismaService } from './prisma.service';

/** Global: any module (and the future transaction host) injects PrismaService without importing this. */
@Global()
@Module({})
export class PrismaModule {
  static forRoot(options: CreatePrismaClientOptions): DynamicModule {
    return {
      module: PrismaModule,
      providers: [{ provide: PrismaService, useFactory: () => new PrismaService(options) }],
      exports: [PrismaService],
    };
  }
}
