-- CreateEnum
CREATE TYPE "TagStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable — adds rich metadata + status to existing minimal Tag table.
-- updatedAt gets DEFAULT CURRENT_TIMESTAMP to satisfy NOT NULL on any
-- pre-existing rows (currently zero, but defensive).
ALTER TABLE "Tag" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "description" TEXT,
ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "status" "TagStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
