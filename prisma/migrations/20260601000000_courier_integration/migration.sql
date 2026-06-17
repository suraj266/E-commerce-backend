-- CreateEnum
CREATE TYPE "CourierProvider" AS ENUM ('SHIPROCKET', 'MOCK');

-- CreateEnum
CREATE TYPE "CourierAccountStatus" AS ENUM ('PENDING', 'CONNECTED', 'ERROR', 'DISABLED');

-- AlterTable
ALTER TABLE "SellerOrder" ADD COLUMN     "awbCode" TEXT,
ADD COLUMN     "billableWeightKg" DECIMAL(10,3),
ADD COLUMN     "labelUrl" TEXT,
ADD COLUMN     "providerOrderId" TEXT,
ADD COLUMN     "quotedShippingRate" DECIMAL(10,2),
ADD COLUMN     "selectedCourierId" TEXT,
ADD COLUMN     "selectedCourierName" TEXT,
ADD COLUMN     "shipmentId" TEXT,
ADD COLUMN     "shippingProvider" "CourierProvider",
ADD COLUMN     "shippingRateSource" VARCHAR(12);

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "providerLocationId" TEXT;

-- CreateTable
CREATE TABLE "CourierAccount" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "storeId" TEXT,
    "provider" "CourierProvider" NOT NULL,
    "credentials" TEXT NOT NULL DEFAULT '',
    "encryptedToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "pickupLocationNickname" TEXT,
    "providerLocationId" TEXT,
    "webhookSecret" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "CourierAccountStatus" NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CourierAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierWebhookLog" (
    "id" TEXT NOT NULL,
    "provider" "CourierProvider" NOT NULL,
    "sellerOrderId" TEXT,
    "awbCode" TEXT,
    "providerOrderId" TEXT,
    "rawStatusCode" TEXT,
    "normalizedStatus" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierWebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourierAccount_sellerId_isEnabled_idx" ON "CourierAccount"("sellerId", "isEnabled");

-- CreateIndex
CREATE INDEX "CourierAccount_webhookSecret_idx" ON "CourierAccount"("webhookSecret");

-- CreateIndex
CREATE UNIQUE INDEX "CourierAccount_sellerId_provider_storeId_key" ON "CourierAccount"("sellerId", "provider", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "CourierWebhookLog_dedupeKey_key" ON "CourierWebhookLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "CourierWebhookLog_sellerOrderId_idx" ON "CourierWebhookLog"("sellerOrderId");

-- CreateIndex
CREATE INDEX "CourierWebhookLog_awbCode_idx" ON "CourierWebhookLog"("awbCode");

-- CreateIndex
CREATE INDEX "SellerOrder_awbCode_idx" ON "SellerOrder"("awbCode");

-- CreateIndex
CREATE INDEX "SellerOrder_shipmentId_idx" ON "SellerOrder"("shipmentId");

-- AddForeignKey
ALTER TABLE "CourierAccount" ADD CONSTRAINT "CourierAccount_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

