import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { SessionScope, UserKind, UserStatus } from '@tms/contracts';
import { PrismaService } from '@tms/db/nest';
import { resetTestDatabase } from '@tms/db/testing';
import { seedDatabase } from '@tms/db';
import { SessionCookie, SessionService } from '@tms/domain/admin';
import type { InMemoryMailSender, MailMessage } from '@tms/domain/shared';

export async function seedBase(app: INestApplication): Promise<PrismaService> {
  await resetTestDatabase();
  const prisma = app.get(PrismaService);
  await seedDatabase(prisma, { bootstrapAdmin: { email: 'bootstrap@example.com' } });
  return prisma;
}

export async function roleIdByKey(
  prisma: PrismaService,
  key: 'admin' | 'operator' | 'driver',
): Promise<string> {
  return (await prisma.role.findUniqueOrThrow({ where: { key } })).id;
}

export interface StaffUserOptions {
  role?: 'admin' | 'operator' | 'driver';
  status?: UserStatus;
  kind?: UserKind;
  enrolled?: boolean;
  email?: string;
}

/** A user row without credentials; Tasks 14 and 16 add `withCredentials` on top. */
export async function createStaffUser(prisma: PrismaService, o: StaffUserOptions = {}) {
  const email = o.email ?? `${randomUUID()}@example.com`;
  return prisma.user.create({
    data: {
      kind: o.kind ?? 'STAFF',
      username: email.split('@')[0] ?? email,
      firstName: 'Test',
      lastName: 'User',
      email,
      status: o.status ?? 'ACTIVE',
      roleId: await roleIdByKey(prisma, o.role ?? 'admin'),
      locale: 'en',
      totpEnabledAt: (o.enrolled ?? true) ? new Date('2026-01-01T00:00:00Z') : null,
      totpSecretEnc: (o.enrolled ?? true) ? 'fixture-without-secret' : null,
    },
  });
}

/** Issues a session directly (bypassing login) and returns the Cookie header value. */
export async function loginAs(
  app: INestApplication,
  userId: string,
  scope: SessionScope = 'FULL',
): Promise<string> {
  const issued = await app
    .get(SessionService)
    .create(userId, scope, { mfaVerified: scope === 'FULL' });
  return `${app.get(SessionCookie).name}=${issued.token}`;
}

/**
 * Resolves with the newest message to `to` once one is in the outbox (polls every 10 ms).
 * Before an action whose mail replaces an earlier one to the same address, call `t.mail.clear()`.
 */
export async function waitForMail(
  mail: InMemoryMailSender,
  to: string,
  timeoutMs = 1000,
): Promise<MailMessage> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = [...mail.sent].reverse().find((m) => m.to === to);
    if (found) return found;
    if (Date.now() >= deadline) throw new Error(`no mail to ${to} within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
