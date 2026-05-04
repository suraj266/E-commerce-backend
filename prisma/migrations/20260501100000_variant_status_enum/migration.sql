-- CreateEnum
CREATE TYPE "VariantStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'OUT_OF_STOCK');

-- AlterTable: convert status column from String to enum.
-- Existing rows had status='active' (lowercase string); the new column gets
-- DEFAULT 'ACTIVE' so they all flip to the canonical enum value cleanly.
ALTER TABLE "ProductVariant" DROP COLUMN "status",
ADD COLUMN     "status" "VariantStatus" NOT NULL DEFAULT 'ACTIVE';
