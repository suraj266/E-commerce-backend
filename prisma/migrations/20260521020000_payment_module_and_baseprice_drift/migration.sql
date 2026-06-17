-- =============================================================================
-- Payment module + Product.basePrice — drift reconciliation
-- =============================================================================
-- These objects (the Payment + PaymentGatewayConfig tables, their enums, the
-- PaymentStatus.AWAITING_PAYMENT value, and Product.basePrice) were added to
-- the Prisma schema during development via `prisma db push`, which syncs the
-- live DB without generating migration files. As a result a fresh
-- `prisma migrate deploy` never recreated them. This migration captures that
-- drift so a clean database matches the schema. Purely additive (plus a stale
-- index drop) — safe to run on existing databases that already have the
-- columns via db push? No: existing prod-style DBs were built by migrate
-- deploy and are missing these, which is exactly what this fixes.
-- =============================================================================

-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('COD', 'RAZORPAY', 'STRIPE', 'PHONEPE');

-- CreateEnum
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProcessingFeeType" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "GatewayPaymentType" AS ENUM ('WEBSITE_EMBEDDED', 'REDIRECT');

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'AWAITING_PAYMENT';

-- DropIndex
DROP INDEX "Product_taxId_idx";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "basePrice" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "PaymentGatewayConfig" (
    "id" TEXT NOT NULL,
    "gateway" "PaymentGateway" NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "supportedMethods" JSONB NOT NULL DEFAULT '[]',
    "credentials" TEXT NOT NULL DEFAULT '',
    "sandboxMode" BOOLEAN NOT NULL DEFAULT true,
    "processingFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "processingFeeType" "ProcessingFeeType" NOT NULL DEFAULT 'FIXED',
    "paymentType" "GatewayPaymentType" NOT NULL DEFAULT 'WEBSITE_EMBEDDED',
    "instructions" TEXT,
    "webhookUrl" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentGatewayConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "gateway" "PaymentGateway" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "processingFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'CREATED',
    "gatewayOrderId" TEXT,
    "gatewayPaymentId" TEXT,
    "gatewaySignature" TEXT,
    "gatewayResponse" JSONB NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "expiresAt" TIMESTAMP(3),
    "authorizedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentGatewayConfig_gateway_key" ON "PaymentGatewayConfig"("gateway");

-- CreateIndex
CREATE INDEX "PaymentGatewayConfig_isEnabled_displayOrder_idx" ON "PaymentGatewayConfig"("isEnabled", "displayOrder");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_gatewayOrderId_idx" ON "Payment"("gatewayOrderId");

-- CreateIndex
CREATE INDEX "Payment_gatewayPaymentId_idx" ON "Payment"("gatewayPaymentId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
