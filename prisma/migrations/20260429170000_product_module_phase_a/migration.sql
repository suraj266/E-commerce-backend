-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('SIMPLE', 'VARIABLE');

-- AlterTable: Product — convert status/productType to enums, add brandId + specifications
ALTER TABLE "Product" ADD COLUMN     "brandId" TEXT,
ADD COLUMN     "specifications" JSONB NOT NULL DEFAULT '[]',
DROP COLUMN "productType",
ADD COLUMN     "productType" "ProductType" NOT NULL DEFAULT 'SIMPLE',
DROP COLUMN "status",
ADD COLUMN     "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT';

-- CreateTable: implicit M:N junction for Product ↔ Tag
CREATE TABLE "_ProductTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_ProductTags_AB_unique" ON "_ProductTags"("A", "B");

-- CreateIndex
CREATE INDEX "_ProductTags_B_index" ON "_ProductTags"("B");

-- CreateIndex: ensure slug uniqueness was already there; this re-creates it
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex: query indexes for common filters
CREATE INDEX "Product_storeId_status_idx" ON "Product"("storeId", "status");

-- CreateIndex
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductTags" ADD CONSTRAINT "_ProductTags_A_fkey" FOREIGN KEY ("A") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductTags" ADD CONSTRAINT "_ProductTags_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
