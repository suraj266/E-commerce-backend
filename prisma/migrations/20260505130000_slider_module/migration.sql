-- Slider library — reusable carousel content with responsive images per
-- slide. Page builder blocks reference sliders by `key` (stable identifier).

CREATE TYPE "SliderStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "Slider" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "description" TEXT,
  "status"      "SliderStatus" NOT NULL DEFAULT 'DRAFT',
  "config"      JSONB NOT NULL DEFAULT '{}',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "deletedAt"   TIMESTAMP(3),

  CONSTRAINT "Slider_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Slider_key_key" ON "Slider"("key");

CREATE TABLE "SlideItem" (
  "id"             TEXT NOT NULL,
  "sliderId"       TEXT NOT NULL,
  "title"          TEXT,
  "description"    TEXT,
  "link"           TEXT,
  "ctaLabel"       TEXT,
  "imageUrl"       TEXT,
  "tabletImageUrl" TEXT,
  "mobileImageUrl" TEXT,
  "order"          INTEGER NOT NULL DEFAULT 0,
  "isEnabled"      BOOLEAN NOT NULL DEFAULT true,
  "metadata"       JSONB NOT NULL DEFAULT '{}',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "deletedAt"      TIMESTAMP(3),

  CONSTRAINT "SlideItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SlideItem_sliderId_order_idx" ON "SlideItem"("sliderId", "order");

ALTER TABLE "SlideItem"
  ADD CONSTRAINT "SlideItem_sliderId_fkey"
  FOREIGN KEY ("sliderId") REFERENCES "Slider"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
