-- P3-10 · Soft-delete partial indexes.
--
-- Partial indexes scoped to `WHERE "deletedAt" IS NULL` on the genuinely HOT
-- soft-deletable tables — the ones whose hot read paths always filter out
-- soft-deleted rows (today via hand-written `where: { deletedAt: null }`, soon
-- via the PrismaService `$extends` soft-delete extension). Indexing only the
-- LIVE rows keeps these indexes small and lets Postgres satisfy the ubiquitous
-- `deletedAt IS NULL AND <fk/status>` predicate from the index alone.
--
-- These partial indexes CANNOT be expressed in schema.prisma (Prisma does not
-- model partial/filtered indexes), so they live only here. They are additive
-- and reference only pre-existing columns.
--
-- ⚠️ PRODUCTION DEPLOY (userAction — see report): plain `CREATE INDEX` takes an
-- ACCESS EXCLUSIVE lock and CANNOT run as `CREATE INDEX CONCURRENTLY` inside a
-- migration transaction. On a large/live database, run the CONCURRENTLY
-- equivalents by hand in a low-traffic window BEFORE applying this migration
-- (then this file's `CREATE INDEX ... IF NOT EXISTS` becomes a no-op), e.g.:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_storeId_status_active_idx"
--     ON "Product" ("storeId", "status") WHERE "deletedAt" IS NULL;
-- `IF NOT EXISTS` on every statement below makes the two paths idempotent.

-- Catalog — storefront + admin product listing (where storeId/status, live only)
CREATE INDEX IF NOT EXISTS "Product_storeId_status_active_idx"
  ON "Product" ("storeId", "status") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Product_categoryId_active_idx"
  ON "Product" ("categoryId") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "ProductVariant_productId_active_idx"
  ON "ProductVariant" ("productId") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Category_parentId_active_idx"
  ON "Category" ("parentId") WHERE "deletedAt" IS NULL;

-- Orders — customer "my orders" + admin/status listing (live only)
CREATE INDEX IF NOT EXISTS "Order_customerId_active_idx"
  ON "Order" ("customerId") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Order_status_active_idx"
  ON "Order" ("status") WHERE "deletedAt" IS NULL;

-- Seller fulfillment — seller dashboards filter (sellerId, status), live only
CREATE INDEX IF NOT EXISTS "SellerOrder_sellerId_status_active_idx"
  ON "SellerOrder" ("sellerId", "status") WHERE "deletedAt" IS NULL;

-- Cart — one live cart per customer / guest session
CREATE INDEX IF NOT EXISTS "Cart_customerId_active_idx"
  ON "Cart" ("customerId") WHERE "deletedAt" IS NULL;

-- Reviews — product-detail review lists filter (productId, status), live only
CREATE INDEX IF NOT EXISTS "Review_productId_status_active_idx"
  ON "Review" ("productId", "status") WHERE "deletedAt" IS NULL;

-- Sellers / stores / warehouses — admin + storefront tenancy joins, live only
CREATE INDEX IF NOT EXISTS "Seller_userId_active_idx"
  ON "Seller" ("userId") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Store_sellerId_active_idx"
  ON "Store" ("sellerId") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Warehouse_storeId_active_idx"
  ON "Warehouse" ("storeId") WHERE "deletedAt" IS NULL;

-- Inventory — stock checks by variant, live only
CREATE INDEX IF NOT EXISTS "Inventory_variantId_active_idx"
  ON "Inventory" ("variantId") WHERE "deletedAt" IS NULL;
