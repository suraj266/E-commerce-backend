-- Phase 1: order idempotency, per-account login lockout, inventory non-negative backstop.
-- Additive-only and safe to apply to existing data.

-- Order idempotency key (nullable). The composite unique makes a duplicate
-- checkout submit fail with P2002, which placement resolves to the original order.
ALTER TABLE "Order" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Order_customerId_idempotencyKey_key" ON "Order"("customerId", "idempotencyKey");

-- Per-account brute-force lockout fields.
ALTER TABLE "User"
  ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- Non-negative inventory backstop. The application enforces this with a guarded
-- conditional decrement; this CHECK is a defence-in-depth so no code path can
-- ever persist negative stock. (Prisma does not model CHECK constraints — this
-- is intentionally raw SQL; see inventory.prisma for the documenting comment.)
ALTER TABLE "Inventory"
  ADD CONSTRAINT "inventory_qty_nonneg"
  CHECK ("quantityAvailable" >= 0 AND "quantityReserved" >= 0);
