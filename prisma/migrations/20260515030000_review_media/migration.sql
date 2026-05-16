-- Review media (images + videos) attached to customer reviews.

CREATE TYPE "ReviewMediaType" AS ENUM ('IMAGE', 'VIDEO');

CREATE TABLE "ReviewMedia" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "type" "ReviewMediaType" NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "sizeBytes" INTEGER NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewMedia_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReviewMedia_reviewId_idx" ON "ReviewMedia"("reviewId");

ALTER TABLE "ReviewMedia"
  ADD CONSTRAINT "ReviewMedia_reviewId_fkey"
  FOREIGN KEY ("reviewId") REFERENCES "Review"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
