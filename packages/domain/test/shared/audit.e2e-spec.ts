import { Controller, Get, Inject, Injectable, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditMetadataError, type AuditMetadata } from '@tms/contracts';
import { PrismaModule, PrismaService } from '@tms/db/nest';
import { makeStaffUser, resetTestDatabase, testDatabaseUrl } from '@tms/db/testing';
import { createLoggerModule, LOG_DESTINATION, Logger } from '@tms/logger';
import { MemoryLogStream, type LogRecord } from '@tms/logger/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  type AppTransactionHost,
  AuditService,
  Clock,
  ClsService,
  FixedClock,
  Propagation,
  REQUEST_CONTEXT_KEY,
  type RequestContext,
  SharedModule,
  Transactional,
  TransactionHost,
} from '../../src/shared';

const AT = new Date('2026-09-24T08:00:00.000Z');

type RoleCreated = AuditMetadata<'admin.role.created'>;

@Injectable()
class ProbeService {
  constructor(
    @Inject(TransactionHost) private readonly txHost: AppTransactionHost,
    private readonly audit: AuditService,
  ) {}

  /** A state change and its audit record in one transaction; `fail` throws after both writes. */
  @Transactional()
  async createRoleAndAudit(
    options: { fail?: boolean; metadata?: RoleCreated } = {},
  ): Promise<string> {
    const role = await this.txHost.tx.role.create({
      data: { name: 'Probe role', description: 'Created by the audit probe', appliesTo: 'STAFF' },
    });
    await this.audit.record({
      action: 'admin.role.created',
      outcome: 'SUCCESS',
      target: { type: 'Role', id: role.id },
      metadata: options.metadata,
    });
    if (options.fail === true) throw new Error('probe failure after the audit record');
    return role.id;
  }

  /** The nested step rolls back to its savepoint; the outer work and its audit row commit. */
  @Transactional()
  async createRoleDespiteFailedNestedStep(): Promise<void> {
    await this.createRoleAndAudit();
    await this.failingNestedStep().catch(() => undefined);
  }

  @Transactional(Propagation.Nested)
  async failingNestedStep(): Promise<void> {
    await this.txHost.tx.role.create({
      data: {
        name: 'Nested role',
        description: 'Rolled back to the savepoint',
        appliesTo: 'STAFF',
      },
    });
    await this.audit.record({ action: 'admin.role.created', outcome: 'SUCCESS' });
    throw new Error('nested step failed');
  }
}

@Controller('probe')
class ProbeController {
  constructor(
    private readonly audit: AuditService,
    private readonly cls: ClsService,
  ) {}

  @Get()
  async probe(): Promise<{ clsId: string; contextId: string | undefined }> {
    await this.audit.record({ action: 'admin.role.created', outcome: 'FAILURE' });
    return {
      clsId: this.cls.getId(),
      contextId: this.cls.get<RequestContext | undefined>(REQUEST_CONTEXT_KEY)?.requestId,
    };
  }
}

const probeLineId = (record: LogRecord): string | undefined => {
  const req = record['req'] as { id?: unknown; url?: unknown } | undefined;
  return req?.url === '/api/probe' && typeof req.id === 'string' ? req.id : undefined;
};

/** pino-http logs on the response's finish event, which can trail supertest: wait, never read once. */
const waitForProbeLine = (logs: MemoryLogStream, id: string): Promise<LogRecord> =>
  logs.waitFor((record) => probeLineId(record) === id);

async function createProbeApp(options: {
  logs: MemoryLogStream;
  clock: FixedClock;
  sharedFirst?: boolean;
}): Promise<INestApplication<App>> {
  const logger = createLoggerModule({
    app: 'api-admin',
    level: 'info',
    file: { enabled: false, dir: 'logs', retentionDays: 1 },
  });
  const shared = SharedModule.forRoot({ app: 'ADMIN' });
  const moduleRef = await Test.createTestingModule({
    imports: [
      ...(options.sharedFirst === true ? [shared, logger] : [logger, shared]),
      PrismaModule.forRoot({ url: testDatabaseUrl() }),
    ],
    controllers: [ProbeController],
    providers: [ProbeService],
  })
    .overrideProvider(LOG_DESTINATION)
    .useValue(options.logs)
    .overrideProvider(Clock)
    .useValue(options.clock)
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({ bufferLogs: true });
  app.setGlobalPrefix('api');
  app.useLogger(app.get(Logger));
  await app.listen(0, '127.0.0.1');
  return app;
}

describe('SharedModule: audit inside the caller transaction (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let probe: ProbeService;
  let audit: AuditService;
  let txHost: AppTransactionHost;
  // One stream for every app of this file: nestjs-pino keeps one pino-http instance per process.
  const logs = new MemoryLogStream();
  const clock = new FixedClock(AT);

  beforeAll(async () => {
    app = await createProbeApp({ logs, clock });
    prisma = app.get(PrismaService);
    probe = app.get(ProbeService);
    audit = app.get(AuditService);
    txHost = app.get<AppTransactionHost>(TransactionHost);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    clock.set(AT);
  });

  afterAll(async () => {
    await app.close();
  });

  it('commits the state change and the audit row together', async () => {
    const roleId = await probe.createRoleAndAudit();
    expect(await prisma.role.count()).toBe(1);
    const [row, ...others] = await prisma.auditLog.findMany();
    expect(others).toEqual([]);
    expect(row?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(row).toMatchObject({
      at: AT,
      app: 'ADMIN',
      actorUserId: null,
      action: 'admin.role.created',
      targetType: 'Role',
      targetId: roleId,
      outcome: 'SUCCESS',
      ip: null,
      userAgent: null,
      metadata: {},
    });
  });

  it('rolls the audit row back with the caller', async () => {
    await expect(probe.createRoleAndAudit({ fail: true })).rejects.toThrow(
      'probe failure after the audit record',
    );
    expect(await prisma.role.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('rejects unknown metadata keys and rolls back the state change (fail-closed)', async () => {
    const invalid = { unexpected: 1 } as unknown as RoleCreated;
    const error: unknown = await probe
      .createRoleAndAudit({ metadata: invalid })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuditMetadataError);
    expect(error).toMatchObject({ action: 'admin.role.created' });
    expect((error as AuditMetadataError).issues.map((issue) => issue.code)).toEqual([
      'unrecognized_keys',
    ]);
    expect(await prisma.role.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('rolls a nested step back to its savepoint and keeps the outer work', async () => {
    await probe.createRoleDespiteFailedNestedStep();
    expect((await prisma.role.findMany()).map((role) => role.name)).toEqual(['Probe role']);
    expect(await prisma.auditLog.count()).toBe(1);
  });

  it('autocommits when called outside a transaction', async () => {
    const actor = await makeStaffUser(prisma, { username: 'audit-actor' });
    clock.advance(1500);
    await audit.record({
      action: 'admin.user.role-changed',
      outcome: 'SUCCESS',
      actorUserId: actor.id,
      target: { type: 'User', id: actor.id },
      metadata: { fromRoleId: 'role-a', toRoleId: 'role-b' },
    });
    expect(await prisma.auditLog.findMany()).toMatchObject([
      {
        actorUserId: actor.id,
        action: 'admin.user.role-changed',
        targetType: 'User',
        targetId: actor.id,
        metadata: { fromRoleId: 'role-a', toRoleId: 'role-b' },
        at: new Date(AT.getTime() + 1500),
      },
    ]);
  });

  it('uses the PrismaService instance itself outside a transaction', () => {
    expect(txHost.tx).toBe(prisma);
    expect(txHost.isTransactionActive()).toBe(false);
  });

  it('stores ip and user agent of the request and shares its id with the logger', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/probe')
      .set('X-Request-Id', 'req-1')
      .set('User-Agent', 'UA/1')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('req-1');
    expect(res.body).toEqual({ clsId: 'req-1', contextId: 'req-1' });
    const [row] = await prisma.auditLog.findMany();
    expect(row).toMatchObject({ outcome: 'FAILURE', userAgent: 'UA/1', actorUserId: null });
    expect(row?.ip).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
    await waitForProbeLine(logs, 'req-1');
  });

  it('truncates the user agent and replaces a hostile X-Request-Id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/probe')
      .set('X-Request-Id', 'x'.repeat(200))
      .set('User-Agent', 'U'.repeat(600))
      .expect(200);
    const minted = res.headers['x-request-id'] as string;
    expect(minted).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(res.body).toEqual({ clsId: minted, contextId: minted });
    const [row] = await prisma.auditLog.findMany();
    expect(row?.userAgent).toBe('U'.repeat(512));
    await waitForProbeLine(logs, minted);
  });

  it('keeps header, CLS id and log id equal under 50 concurrent requests', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `concurrent-${i}`);
    const responses = await Promise.all(
      ids.map((id) => request(app.getHttpServer()).get('/api/probe').set('X-Request-Id', id)),
    );
    responses.forEach((res, i) => {
      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBe(ids[i]);
      expect(res.body).toEqual({ clsId: ids[i], contextId: ids[i] });
    });
    await Promise.all(ids.map((id) => waitForProbeLine(logs, id)));
    expect(await prisma.auditLog.count()).toBe(50);
  });

  it('echoes the request id when SharedModule is imported before the logger', async () => {
    const other = await createProbeApp({ logs, clock, sharedFirst: true });
    try {
      const res = await request(other.getHttpServer())
        .get('/api/probe')
        .set('X-Request-Id', 'req-order')
        .expect(200);
      expect(res.headers['x-request-id']).toBe('req-order');
      expect(res.body).toEqual({ clsId: 'req-order', contextId: 'req-order' });
    } finally {
      await other.close();
    }
  });
});
