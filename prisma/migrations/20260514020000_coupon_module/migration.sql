-- =============================================================================
-- Coupon module
-- =============================================================================
-- The Coupon table was created out-of-band on an earlier schema iteration.
-- This migration only adds what's still missing:
--   - CouponRedemption (usage tracking — load-bearing for usageLimit checks)
--   - Order.couponId + Order.couponCode (FK + snapshot)
--   - Indexes on Coupon (.code, .isActive, .validUntil)
--   - FK from Order.couponId → Coupon.id (SET NULL on delete)

-- CreateTable: CouponRedemption
CREATE TABLE IF NOT EXISTS "CouponRedemption" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "discountAmount" DECIMAL(10,2) NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

-- AlterTable: Order
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "couponId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "couponCode" TEXT;

-- Indexes on Coupon (idempotent)
CREATE INDEX IF NOT EXISTS "Coupon_code_idx" ON "Coupon"("code");
CREATE INDEX IF NOT EXISTS "Coupon_isActive_idx" ON "Coupon"("isActive");
CREATE INDEX IF NOT EXISTS "Coupon_validUntil_idx" ON "Coupon"("validUntil");

-- Indexes on CouponRedemption
CREATE UNIQUE INDEX IF NOT EXISTS "CouponRedemption_orderId_key" ON "CouponRedemption"("orderId");
CREATE INDEX IF NOT EXISTS "CouponRedemption_couponId_idx" ON "CouponRedemption"("couponId");
CREATE INDEX IF NOT EXISTS "CouponRedemption_customerId_idx" ON "CouponRedemption"("customerId");
CREATE INDEX IF NOT EXISTS "CouponRedemption_redeemedAt_idx" ON "CouponRedemption"("redeemedAt");

-- Index on Order.couponId
CREATE INDEX IF NOT EXISTS "Order_couponId_idx" ON "Order"("couponId");

-- Foreign keys — wrapped in DO blocks so reruns don't error.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Order_couponId_fkey'
  ) THEN
    ALTER TABLE "Order"
      ADD CONSTRAINT "Order_couponId_fkey"
      FOREIGN KEY ("couponId") REFERENCES "Coupon"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CouponRedemption_couponId_fkey'
  ) THEN
    ALTER TABLE "CouponRedemption"
      ADD CONSTRAINT "CouponRedemption_couponId_fkey"
      FOREIGN KEY ("couponId") REFERENCES "Coupon"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CouponRedemption_orderId_fkey'
  ) THEN
    ALTER TABLE "CouponRedemption"
      ADD CONSTRAINT "CouponRedemption_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CouponRedemption_customerId_fkey'
  ) THEN
    ALTER TABLE "CouponRedemption"
      ADD CONSTRAINT "CouponRedemption_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
