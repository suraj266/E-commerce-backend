-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('INDIVIDUAL', 'PROPRIETORSHIP', 'PARTNERSHIP', 'LLP', 'PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'HUF');

-- CreateEnum
CREATE TYPE "SellerStatus" AS ENUM ('DRAFT', 'PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- AlterTable
ALTER TABLE "Seller" DROP COLUMN "businessName",
DROP COLUMN "taxId",
DROP COLUMN "verificationDocs",
DROP COLUMN "verificationStatus",
ADD COLUMN     "bankVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "businessEmail" TEXT NOT NULL,
ADD COLUMN     "businessPhone" TEXT NOT NULL,
ADD COLUMN     "dateOfIncorporation" TIMESTAMP(3),
ADD COLUMN     "displayName" TEXT NOT NULL,
ADD COLUMN     "documentsVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "gstin" TEXT,
ADD COLUMN     "gstinVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "legalName" TEXT NOT NULL,
ADD COLUMN     "overallStatus" "SellerStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "panNumber" TEXT NOT NULL,
ADD COLUMN     "panVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "registrationNumber" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "signatoryDesignation" TEXT,
ADD COLUMN     "signatoryName" TEXT,
ADD COLUMN     "signatoryPan" TEXT,
ADD COLUMN     "supportEmail" TEXT,
DROP COLUMN "businessType",
ADD COLUMN     "businessType" "BusinessType" NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Seller_panNumber_key" ON "Seller"("panNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Seller_gstin_key" ON "Seller"("gstin");

-- CreateIndex
CREATE UNIQUE INDEX "Seller_businessEmail_key" ON "Seller"("businessEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Seller_businessPhone_key" ON "Seller"("businessPhone");
