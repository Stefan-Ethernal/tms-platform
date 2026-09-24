-- DropIndex
DROP INDEX "ActionToken_userId_idx";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lockoutLevel" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "ActionToken_userId_type_idx" ON "ActionToken"("userId", "type");
