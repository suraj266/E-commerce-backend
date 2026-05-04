-- Tax catalog + FK on Product.
-- Sellers pick one tax per product via the product form. Existing products
-- stay with taxId=NULL until a seller assigns one (no data migration needed).

CREATE TABLE "Tax" (
  "id"           TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "rate"         DECIMAL(5,2) NOT NULL,
  "description"  TEXT,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  "deletedAt"    TIMESTAMP(3),

  CONSTRAINT "Tax_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Tax_name_key" ON "Tax"("name");

ALTER TABLE "Product" ADD COLUMN "taxId" TEXT;

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_taxId_fkey"
  FOREIGN KEY ("taxId") REFERENCES "Tax"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Product_taxId_idx" ON "Product"("taxId");
