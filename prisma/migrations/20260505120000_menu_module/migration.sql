-- Menu module — admin-managed navigation surfaces (header + footer).
-- One row per location enforced by unique constraint. Items tree stored
-- as JSON (mirrors page.blocks pattern). Seeded after migration.

CREATE TYPE "MenuLocation" AS ENUM (
  'HEADER_PRIMARY',
  'HEADER_TOP',
  'FOOTER_SHOP',
  'FOOTER_HELP',
  'FOOTER_COMPANY',
  'FOOTER_LEGAL',
  'FOOTER_SOCIAL'
);

CREATE TABLE "Menu" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "location"  "MenuLocation" NOT NULL,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "items"     JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Menu_location_key" ON "Menu"("location");
