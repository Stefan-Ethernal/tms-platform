import { createPrismaClient, type PrismaClient } from '../src';
import {
  TEST_DAY,
  makeCarrier,
  makeDriverProfile,
  makeDriverUser,
  makeIdentityCard,
  makeLoadingOrder,
  makeProduct,
  makeVehicle,
  resetTestDatabase,
  testDatabaseUrl,
} from '../src/testing';
import { expectKnownRequestError } from './support/prisma-errors';

describe('drivers, master data and operations schema', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    await resetTestDatabase();
    prisma = createPrismaClient({ url: testDatabaseUrl() });
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  /** One driver with profile, one vehicle and one product: enough to create orders. */
  async function orderGraph() {
    const carrier = await makeCarrier(prisma);
    const driver = await makeDriverUser(prisma);
    await makeDriverProfile(prisma, { userId: driver.id, carrierId: carrier.id });
    const vehicle = await makeVehicle(prisma, { carrierId: carrier.id });
    const product = await makeProduct(prisma);
    const order = () =>
      makeLoadingOrder(prisma, {
        driverId: driver.id,
        vehicleId: vehicle.id,
        carrierId: carrier.id,
        productId: product.id,
      });
    return { carrier, driver, vehicle, product, order };
  }

  function queueEntry(orderId: string, sequenceNumber: number, activeOrderId: string | null) {
    return prisma.queueEntry.create({
      data: {
        orderId,
        activeOrderId,
        day: TEST_DAY,
        sequenceNumber,
        checkedInAt: new Date(),
        checkedInVia: 'KIOSK',
      },
    });
  }

  it('lets finished entries of one order coexist with activeOrderId = null', async () => {
    const { order } = await orderGraph();
    const first = await order();
    await queueEntry(first.id, 1, null);
    await queueEntry(first.id, 2, null);

    expect(
      await prisma.queueEntry.count({ where: { orderId: first.id, activeOrderId: null } }),
    ).toBe(2);
  });

  it('allows one active entry per order (P2002 on QueueEntry_activeOrderId_key)', async () => {
    const { order } = await orderGraph();
    const first = await order();
    const created = await queueEntry(first.id, 1, first.id);
    expect(created.status).toBe('WAITING');

    await expectKnownRequestError(queueEntry(first.id, 2, first.id), {
      code: 'P2002',
      constraint: 'QueueEntry_activeOrderId_key',
    });
  });

  it('rejects a duplicate (day, sequenceNumber) (P2002 on QueueEntry_day_sequenceNumber_key)', async () => {
    const { order } = await orderGraph();
    const first = await order();
    const second = await order();
    await queueEntry(first.id, 1, first.id);

    await expectKnownRequestError(queueEntry(second.id, 1, second.id), {
      code: 'P2002',
      constraint: 'QueueEntry_day_sequenceNumber_key',
    });
  });

  it('rejects a duplicate Vehicle.registration (P2002 on Vehicle_registration_key)', async () => {
    const carrier = await makeCarrier(prisma);
    await makeVehicle(prisma, { carrierId: carrier.id, registration: 'AB-123-CD' });

    await expectKnownRequestError(
      makeVehicle(prisma, { carrierId: carrier.id, registration: 'AB-123-CD', kind: 'RAIL_WAGON' }),
      { code: 'P2002', constraint: 'Vehicle_registration_key' },
    );
  });

  it('rejects a duplicate IdentityCard.serial (P2002 on IdentityCard_serial_key)', async () => {
    // Two drivers, so only the serial collides, not activeUserId.
    const [first, second] = [await makeDriverUser(prisma), await makeDriverUser(prisma)];
    const created = await makeIdentityCard(prisma, { userId: first.id, serial: 'CARD-0001' });
    expect(created.status).toBe('ACTIVE');

    await expectKnownRequestError(
      makeIdentityCard(prisma, { userId: second.id, serial: 'CARD-0001' }),
      { code: 'P2002', constraint: 'IdentityCard_serial_key' },
    );
  });

  it('allows one ACTIVE card per driver (P2002 on IdentityCard_activeUserId_key)', async () => {
    const driver = await makeDriverUser(prisma);
    const active = await makeIdentityCard(prisma, { userId: driver.id });
    expect(active.activeUserId).toBe(driver.id);

    await expectKnownRequestError(makeIdentityCard(prisma, { userId: driver.id }), {
      code: 'P2002',
      constraint: 'IdentityCard_activeUserId_key',
    });
  });

  it('lets a BLOCKED card and a new ACTIVE card of one driver coexist (activeUserId = null)', async () => {
    const driver = await makeDriverUser(prisma);
    const old = await makeIdentityCard(prisma, { userId: driver.id });
    await prisma.identityCard.update({
      where: { id: old.id },
      data: { status: 'BLOCKED', activeUserId: null },
    });
    await makeIdentityCard(prisma, { userId: driver.id });

    expect(await prisma.identityCard.count({ where: { userId: driver.id } })).toBe(2);
    expect(
      await prisma.identityCard.findMany({ where: { activeUserId: driver.id } }),
    ).toMatchObject([{ status: 'ACTIVE' }]);
  });

  it('gives a driver at most one DriverProfile (P2002 on DriverProfile_pkey)', async () => {
    const carrier = await makeCarrier(prisma);
    const driver = await makeDriverUser(prisma);
    await makeDriverProfile(prisma, { userId: driver.id, carrierId: carrier.id });

    await expectKnownRequestError(
      makeDriverProfile(prisma, { userId: driver.id, carrierId: carrier.id, driverType: 'RAIL' }),
      { code: 'P2002', constraint: 'DriverProfile_pkey' },
    );
  });

  it('keeps a Product that an order references (RESTRICT, P2003 on LoadingOrder_productId_fkey)', async () => {
    const { product, order } = await orderGraph();
    const created = await order();
    expect(created.status).toBe('CREATED');
    expect(created.plannedDate).toEqual(TEST_DAY);

    await expectKnownRequestError(prisma.product.delete({ where: { id: product.id } }), {
      code: 'P2003',
      constraint: 'LoadingOrder_productId_fkey',
    });
    expect(await prisma.product.count()).toBe(1);
  });

  it('keeps a driver that an IdentityCard references (D9, P2003 on IdentityCard_userId_fkey)', async () => {
    const driver = await makeDriverUser(prisma);
    await makeIdentityCard(prisma, { userId: driver.id, serial: 'CARD-0002' });

    await expectKnownRequestError(prisma.user.delete({ where: { id: driver.id } }), {
      code: 'P2003',
      constraint: 'IdentityCard_userId_fkey',
    });
  });

  it('bumps QueueDayCounter with UPDATE ... RETURNING (1, then 2)', async () => {
    await prisma.queueDayCounter.create({ data: { day: TEST_DAY } });
    const bump = () => prisma.$queryRaw<{ sequenceNumber: number }[]>`
      UPDATE "QueueDayCounter" SET "next" = "next" + 1 WHERE "day" = ${TEST_DAY}::date
      RETURNING "next" - 1 AS "sequenceNumber"`;

    expect(await bump()).toEqual([{ sequenceNumber: 1 }]);
    expect(await bump()).toEqual([{ sequenceNumber: 2 }]);
    expect(await prisma.queueDayCounter.findUniqueOrThrow({ where: { day: TEST_DAY } })).toEqual({
      day: TEST_DAY,
      next: 3,
    });
  });
});
