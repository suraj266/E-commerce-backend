-- CreateEnum
CREATE TYPE "ImageOwnerType" AS ENUM ('STORE', 'SELLER', 'PRODUCT', 'CATEGORY', 'USER', 'GENERIC');

-- CreateEnum
CREATE TYPE "ImagePurpose" AS ENUM ('LOGO', 'BANNER', 'AVATAR', 'ICON', 'PRODUCT_PRIMARY', 'PRODUCT_GALLERY', 'GENERIC');

-- CreateTable
CREATE TABLE "Image" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "ownerType" "ImageOwnerType" NOT NULL DEFAULT 'GENERIC',
    "ownerId" TEXT,
    "purpose" "ImagePurpose" NOT NULL DEFAULT 'GENERIC',
    "alt" TEXT,
    "uploadedById" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Image_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Image_externalId_key" ON "Image"("externalId");

-- CreateIndex
CREATE INDEX "Image_ownerType_ownerId_idx" ON "Image"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "Image_uploadedById_idx" ON "Image"("uploadedById");
