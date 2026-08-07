-- Phase 4 · Dashboard analytics supporting indexes.
--
-- Backs the READ-ONLY `adminAnalytics` aggregations (net-of-refunds revenue,
-- time-bucketed GMV series, orders-by-status, top sellers) on
-- DashboardService.getAnalytics. Every one of those queries filters a
-- STATUS + a DATE RANGE together — a dimension the existing single-column /
-- (sellerId, status) partial indexes (see 20260718120500_softdelete_partial_indexes)
-- do not cover. These composite partial indexes let Postgres satisfy the
-- `deletedAt IS NULL AND status IN (...) AND <date> >= .. < ..` predicate
-- (and the GROUP BY <date> ordering) from the index alone.
--
-- All three are PARTIAL indexes, which Prisma cannot model in schema.prisma
-- (no filtered-index support), so — like the existing soft-delete partials —
-- they live ONLY in this migration. They are additive and reference only
-- pre-existing columns; there is no schema/model change alongside them.
-- (See the report: a `/// doc-comment on the Order/SellerOrder/Refund models`
-- pointing here would normally accompany this, but those schema files are
-- outside this change's file set — flagged as a wiring TODO.)
--
-- ⚠️ PRODUCTION DEPLOY (userAction — see report): plain `CREATE INDEX` takes an
-- ACCESS EXCLUSIVE lock and CANNOT run as `CREATE INDEX CONCURRENTLY` inside a
-- migration transaction. On a large/live database, run the CONCURRENTLY
-- equivalents by hand in a low-traffic window BEFORE applying this migration
-- (then each `CREATE INDEX ... IF NOT EXISTS` below becomes a no-op), e.g.:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_status_placedAt_active_idx"
--     ON "Order" ("status", "placedAt") WHERE "deletedAt" IS NULL;
-- `IF NOT EXISTS` on every statement makes the two paths idempotent.

-- Orders — revenue aggregate, GMV series (GROUP BY date_trunc(placedAt)), and
-- the orders-by-status range breakdown all filter (status, placedAt), live only.
CREATE INDEX IF NOT EXISTS "Order_status_placedAt_active_idx"
  ON "Order" ("status", "placedAt") WHERE "deletedAt" IS NULL;

-- Seller fulfillment — top-sellers leaderboard groups revenue-bearing
-- SellerOrders over a createdAt window; index (status, createdAt), live only.
CREATE INDEX IF NOT EXISTS "SellerOrder_status_createdAt_active_idx"
  ON "SellerOrder" ("status", "createdAt") WHERE "deletedAt" IS NULL;

-- Refunds — net-of-refunds revenue sums PROCESSED refunds over a createdAt
-- window. Partial on the terminal PROCESSED status keeps the index tiny.
CREATE INDEX IF NOT EXISTS "Refund_processed_createdAt_idx"
  ON "Refund" ("createdAt") WHERE "status" = 'PROCESSED'::"RefundStatus";
