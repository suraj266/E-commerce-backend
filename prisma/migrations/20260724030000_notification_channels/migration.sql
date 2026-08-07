-- Phase 4 (notification depth): Web-Push subscriptions + back-in-stock alert ledger.
--
-- Additive-only and safe to apply to existing data. Both tables use PLAIN SCALAR
-- foreign keys (no relations) — see prisma/schema/notification-channels.prisma —
-- so this migration is self-contained and touches no existing table.

-- One row per browser Web-Push registration. `endpoint` is globally UNIQUE (a
-- browser mints one endpoint per subscription); registerPushSubscription upserts
-- on it so re-subscribing the same browser refreshes the keys in place.
CREATE TABLE "PushSubscription" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "endpoint"  TEXT NOT NULL,
    "p256dh"    TEXT NOT NULL,
    "auth"      TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- Upsert handle: one row per browser endpoint.
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
-- Fan-out read path: all of a user's live endpoints.
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- Dedupe + re-arm ledger for the wishlist back-in-stock alert. One row exists per
-- wishlist item WHILE it is known in-stock and alerted; it is DELETED when the
-- item goes out of stock again, re-arming the next 0->in-stock transition. The
-- UNIQUE on "wishlistItemId" is what makes the sweep's createMany + skipDuplicates
-- (ON CONFLICT DO NOTHING) idempotent so an overlapping sweep never double-alerts.
CREATE TABLE "BackInStockAlert" (
    "id"             TEXT NOT NULL,
    "wishlistItemId" TEXT NOT NULL,
    "variantId"      TEXT,
    "productId"      TEXT NOT NULL,
    "customerId"     TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "alertedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackInStockAlert_pkey" PRIMARY KEY ("id")
);

-- Dedupe unit: one live alert per wishlist item.
CREATE UNIQUE INDEX "BackInStockAlert_wishlistItemId_key" ON "BackInStockAlert"("wishlistItemId");
-- Ops/debug read path: alerts for a given variant.
CREATE INDEX "BackInStockAlert_variantId_idx" ON "BackInStockAlert"("variantId");
