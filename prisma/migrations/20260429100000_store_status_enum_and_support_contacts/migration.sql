-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'UNDER_REVIEW');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "supportEmail" TEXT,
ADD COLUMN     "supportPhone" TEXT,
ALTER COLUMN "currencyCode" SET DEFAULT 'INR',
DROP COLUMN "status",
ADD COLUMN     "status" "StoreStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "locale" SET DEFAULT 'en-IN',
ALTER COLUMN "timezone" SET DEFAULT 'Asia/Kolkata';

-- AlterTable
ALTER TABLE "Warehouse" ALTER COLUMN "countryCode" SET DEFAULT 'IN';
