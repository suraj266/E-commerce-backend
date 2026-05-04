-- CreateEnum
CREATE TYPE "AttributeType" AS ENUM ('SELECT', 'MULTISELECT', 'BOOLEAN', 'TEXT', 'NUMBER');

-- AlterTable: ProductAttribute — add description + metadata, convert type to enum
ALTER TABLE "ProductAttribute" ADD COLUMN     "description" TEXT,
ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}',
DROP COLUMN "type",
ADD COLUMN     "type" "AttributeType" NOT NULL DEFAULT 'SELECT';

-- AlterTable: ProductAttributeValue — add slug (NOT NULL safe since table is empty)
ALTER TABLE "ProductAttributeValue" ADD COLUMN     "slug" TEXT NOT NULL;

-- AlterTable: Tag — drop the bridge DEFAULT we added in tag migration. @updatedAt
-- now manages this column at the application layer; existing rows already
-- populated, no risk.
ALTER TABLE "Tag" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex: composite uniqueness for attribute value slugs
CREATE UNIQUE INDEX "ProductAttributeValue_attributeId_slug_key" ON "ProductAttributeValue"("attributeId", "slug");
