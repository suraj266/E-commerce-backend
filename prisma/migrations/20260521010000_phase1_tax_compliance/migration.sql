-- =============================================================================
-- Phase 1 — Tax Compliance Foundation
-- =============================================================================
-- Adds the data model needed for GST place-of-supply determination, HSN
-- snapshots on order lines, tax-inclusive pricing flag, country-of-origin
-- on products, per-seller invoice numbering, and CGST/SGST/IGST/cess line
-- breakup. See database docs/PHASE_1_IMPLEMENTATION_PLAN.md for details.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Seller + Store: place-of-supply identity
-- ---------------------------------------------------------------------------

ALTER TABLE "Seller"
  ADD COLUMN "stateCode" CHAR(2),
  ADD COLUMN "stateName" TEXT;

ALTER TABLE "Store"
  ADD COLUMN "stateCode" CHAR(2),
  ADD COLUMN "stateName" TEXT;

-- Backfill existing sellers with a GSTIN: state code is the first 2 chars.
-- Sellers without a GSTIN are flagged in app code (must fill during next edit).
UPDATE "Seller"
SET "stateCode" = SUBSTRING("gstin" FROM 1 FOR 2)
WHERE "gstin" IS NOT NULL AND "stateCode" IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Product: country of origin + tax-inclusive flag
-- ---------------------------------------------------------------------------

ALTER TABLE "Product"
  ADD COLUMN "countryOfOrigin"     CHAR(2),
  ADD COLUMN "isPriceTaxInclusive" BOOLEAN NOT NULL DEFAULT true;

-- Existing active products default to India (Indian marketplace assumption).
-- Sellers can override afterward. Draft products stay null so the HSN/
-- country gate from T3 catches them on next publish attempt.
UPDATE "Product"
SET "countryOfOrigin" = 'IN'
WHERE "countryOfOrigin" IS NULL AND "status" = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- 3. Order: buyer GSTIN + place of supply
-- ---------------------------------------------------------------------------

ALTER TABLE "Order"
  ADD COLUMN "buyerGstin"             VARCHAR(15),
  ADD COLUMN "placeOfSupplyStateCode" CHAR(2),
  ADD COLUMN "placeOfSupplyStateName" TEXT;

-- ---------------------------------------------------------------------------
-- 4. SellerOrder: PoS, tax kind, invoice number/date/url
-- ---------------------------------------------------------------------------

ALTER TABLE "SellerOrder"
  ADD COLUMN "placeOfSupplyStateCode" CHAR(2),
  ADD COLUMN "placeOfSupplyStateName" TEXT,
  ADD COLUMN "taxKind"                VARCHAR(20),
  ADD COLUMN "invoiceNumber"          TEXT,
  ADD COLUMN "invoiceDate"            TIMESTAMP(3),
  ADD COLUMN "invoiceUrl"             TEXT;

CREATE UNIQUE INDEX "SellerOrder_invoiceNumber_key" ON "SellerOrder"("invoiceNumber");

-- ---------------------------------------------------------------------------
-- 5. OrderItem: HSN snapshot, country snapshot, full tax breakup
-- ---------------------------------------------------------------------------

ALTER TABLE "OrderItem"
  ADD COLUMN "hsnCode"           VARCHAR(8),
  ADD COLUMN "countryOfOrigin"   CHAR(2),
  ADD COLUMN "priceTaxInclusive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "taxableValue"      DECIMAL(12, 4) NOT NULL DEFAULT 0,
  ADD COLUMN "cgstRate"          DECIMAL(5, 2)  NOT NULL DEFAULT 0,
  ADD COLUMN "cgstAmount"        DECIMAL(12, 4) NOT NULL DEFAULT 0,
  ADD COLUMN "sgstRate"          DECIMAL(5, 2)  NOT NULL DEFAULT 0,
  ADD COLUMN "sgstAmount"        DECIMAL(12, 4) NOT NULL DEFAULT 0,
  ADD COLUMN "igstRate"          DECIMAL(5, 2)  NOT NULL DEFAULT 0,
  ADD COLUMN "igstAmount"        DECIMAL(12, 4) NOT NULL DEFAULT 0,
  ADD COLUMN "cessRate"          DECIMAL(5, 2)  NOT NULL DEFAULT 0,
  ADD COLUMN "cessAmount"        DECIMAL(12, 4) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 6. InvoiceSequence: per-seller-per-FY counter
-- ---------------------------------------------------------------------------

CREATE TABLE "InvoiceSequence" (
    "id"         TEXT         NOT NULL,
    "sellerId"   TEXT         NOT NULL,
    "fiscalYear" VARCHAR(8)   NOT NULL,
    "nextSeq"    INTEGER      NOT NULL DEFAULT 1,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceSequence_sellerId_fiscalYear_key"
  ON "InvoiceSequence"("sellerId", "fiscalYear");

CREATE INDEX "InvoiceSequence_sellerId_idx"
  ON "InvoiceSequence"("sellerId");
