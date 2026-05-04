-- =============================================================================
-- Inventory backfill — Sprint 2.6 M0
-- =============================================================================
-- Two responsibilities:
--   1. Every existing Store gets a default Warehouse if it doesn't already
--      have one (placeholder address — seller edits later in /seller/warehouses).
--   2. Every existing ProductVariant gets a zero-qty Inventory row in its
--      store's default warehouse.
--
-- Both are idempotent: re-running won't duplicate rows. Stores/variants added
-- after this migration are handled by application code (createMyStore +
-- product variant create hook).
-- =============================================================================

-- 1. Default warehouse for stores that don't have one
INSERT INTO "Warehouse" (
  "id", "storeId", "name", "code", "addressLine1", "city", "state",
  "postalCode", "countryCode", "isDefault", "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  s."id",
  'Main warehouse',
  'MAIN',
  'TBD — please update before fulfilling orders',
  'TBD',
  'TBD',
  '000000',
  'IN',
  true,
  true,
  NOW(),
  NOW()
FROM "Store" s
WHERE s."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Warehouse" w
    WHERE w."storeId" = s."id" AND w."deletedAt" IS NULL
  );

-- 2. For stores that have warehouses but none is marked default, promote
--    the oldest one. Defensive cleanup so step 3 always finds one.
WITH ranked AS (
  SELECT
    w."id",
    ROW_NUMBER() OVER (PARTITION BY w."storeId" ORDER BY w."createdAt" ASC) AS rn
  FROM "Warehouse" w
  WHERE w."deletedAt" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "Warehouse" w2
      WHERE w2."storeId" = w."storeId"
        AND w2."isDefault" = true
        AND w2."deletedAt" IS NULL
    )
)
UPDATE "Warehouse"
SET "isDefault" = true
FROM ranked
WHERE "Warehouse"."id" = ranked."id" AND ranked.rn = 1;

-- 3. Zero-qty Inventory row for every existing variant at its store's default
--    warehouse, if one doesn't already exist.
INSERT INTO "Inventory" (
  "id", "variantId", "warehouseId", "quantityAvailable", "quantityReserved",
  "quantityOnHand", "reorderPoint", "reorderQuantity", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  v."id",
  w."id",
  0,
  0,
  0,
  0,
  0,
  NOW(),
  NOW()
FROM "ProductVariant" v
JOIN "Product" p ON p."id" = v."productId" AND p."deletedAt" IS NULL
JOIN "Warehouse" w
  ON w."storeId" = p."storeId"
  AND w."isDefault" = true
  AND w."deletedAt" IS NULL
WHERE v."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Inventory" i
    WHERE i."variantId" = v."id" AND i."warehouseId" = w."id" AND i."deletedAt" IS NULL
  );
