-- CreateEnum
CREATE TYPE "DriverType" AS ENUM ('TRUCK', 'RAIL');

-- CreateEnum
CREATE TYPE "IdentityCardStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "VehicleKind" AS ENUM ('TRUCK', 'RAIL_WAGON');

-- CreateEnum
CREATE TYPE "LoadingPointKind" AS ENUM ('TRUCK_ISLAND', 'RAIL_TRACK');

-- CreateEnum
CREATE TYPE "TransportKind" AS ENUM ('TRUCK', 'RAIL');

-- CreateEnum
CREATE TYPE "LoadingOrderStatus" AS ENUM ('CREATED', 'QUEUED', 'CALLED', 'LOADED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QueueEntryStatus" AS ENUM ('WAITING', 'CALLED', 'DONE', 'REMOVED');

-- CreateEnum
CREATE TYPE "CheckInVia" AS ENUM ('KIOSK', 'MANUAL');

-- CreateTable
CREATE TABLE "Carrier" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Carrier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" UUID NOT NULL,
    "registration" TEXT NOT NULL,
    "carrierId" UUID NOT NULL,
    "kind" "VehicleKind" NOT NULL,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoadingPoint" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "LoadingPointKind" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LoadingPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverProfile" (
    "userId" UUID NOT NULL,
    "driverType" "DriverType" NOT NULL,
    "carrierId" UUID NOT NULL,
    "licenseNumber" TEXT,
    "adrExpiresAt" DATE,
    "pinHash" TEXT NOT NULL,
    "pinFailedCount" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMPTZ(3),
    "pinUpdatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DriverProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "IdentityCard" (
    "id" UUID NOT NULL,
    "serial" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "activeUserId" UUID,
    "status" "IdentityCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "issuedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "IdentityCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoadingOrder" (
    "id" UUID NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "transportKind" "TransportKind" NOT NULL,
    "driverId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "carrierId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantityLiters" INTEGER NOT NULL,
    "plannedDate" DATE NOT NULL,
    "status" "LoadingOrderStatus" NOT NULL DEFAULT 'CREATED',
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LoadingOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "activeOrderId" UUID,
    "day" DATE NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "loadingPointId" UUID,
    "status" "QueueEntryStatus" NOT NULL DEFAULT 'WAITING',
    "checkedInAt" TIMESTAMPTZ(3) NOT NULL,
    "checkedInVia" "CheckInVia" NOT NULL,
    "kioskId" TEXT,
    "calledAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "removedById" UUID,
    "removeReason" TEXT,

    CONSTRAINT "QueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueDayCounter" (
    "day" DATE NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "QueueDayCounter_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE UNIQUE INDEX "Carrier_name_key" ON "Carrier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_registration_key" ON "Vehicle"("registration");

-- CreateIndex
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");

-- CreateIndex
CREATE UNIQUE INDEX "LoadingPoint_code_key" ON "LoadingPoint"("code");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityCard_serial_key" ON "IdentityCard"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityCard_activeUserId_key" ON "IdentityCard"("activeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "LoadingOrder_orderNumber_key" ON "LoadingOrder"("orderNumber");

-- CreateIndex
CREATE INDEX "LoadingOrder_driverId_plannedDate_status_idx" ON "LoadingOrder"("driverId", "plannedDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_activeOrderId_key" ON "QueueEntry"("activeOrderId");

-- CreateIndex
CREATE INDEX "QueueEntry_day_status_idx" ON "QueueEntry"("day", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_day_sequenceNumber_key" ON "QueueEntry"("day", "sequenceNumber");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityCard" ADD CONSTRAINT "IdentityCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadingOrder" ADD CONSTRAINT "LoadingOrder_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadingOrder" ADD CONSTRAINT "LoadingOrder_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadingOrder" ADD CONSTRAINT "LoadingOrder_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadingOrder" ADD CONSTRAINT "LoadingOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadingOrder" ADD CONSTRAINT "LoadingOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "LoadingOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_loadingPointId_fkey" FOREIGN KEY ("loadingPointId") REFERENCES "LoadingPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
