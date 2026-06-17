-- =============================================================================
-- Product labels (badges) + sales-velocity stats
-- =============================================================================
-- Adds the Label entity (manual + auto/rule-based product badges), the
-- Product<->Label M:N junction, and denormalized Product fields that power
-- data-driven auto-labels + smart-collection rules:
--   - onSale       : any active variant has compareAtPrice > price
--   - unitsSold7d  : trailing 7-day units sold (sales-stats cron)
--   - unitsSold30d : trailing 30-day units sold
--   - lastSoldAt   : most recent sale timestamp
-- =============================================================================

-- CreateEnum
CREATE TYPE "LabelType" AS ENUM ('MANUAL', 'AUTO');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "lastSoldAt" TIMESTAMP(3),
ADD COLUMN     "onSale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unitsSold30d" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unitsSold7d" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Label" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "textColor" TEXT,
    "icon" TEXT,
    "type" "LabelType" NOT NULL DEFAULT 'MANUAL',
    "rule" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ProductLabels" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Label_key_key" ON "Label"("key");

-- CreateIndex
CREATE UNIQUE INDEX "_ProductLabels_AB_unique" ON "_ProductLabels"("A", "B");

-- CreateIndex
CREATE INDEX "_ProductLabels_B_index" ON "_ProductLabels"("B");

-- CreateIndex
CREATE INDEX "Product_unitsSold30d_idx" ON "Product"("unitsSold30d");

-- AddForeignKey
ALTER TABLE "_ProductLabels" ADD CONSTRAINT "_ProductLabels_A_fkey" FOREIGN KEY ("A") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductLabels" ADD CONSTRAINT "_ProductLabels_B_fkey" FOREIGN KEY ("B") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
