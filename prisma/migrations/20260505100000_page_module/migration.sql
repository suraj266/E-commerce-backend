-- Page CMS module — admin-composable pages from typed blocks.
-- System pages are seeded after this migration runs (home, about, terms,
-- privacy, help) so the storefront has something at each well-known slug
-- on first boot.

CREATE TYPE "PageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "Page" (
  "id"          TEXT NOT NULL,
  "slug"        TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "metaTitle"   TEXT,
  "metaDesc"    TEXT,
  "status"      "PageStatus" NOT NULL DEFAULT 'DRAFT',
  "blocks"      JSONB NOT NULL DEFAULT '[]',
  "isSystem"    BOOLEAN NOT NULL DEFAULT false,
  "publishedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "deletedAt"   TIMESTAMP(3),

  CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Page_slug_key" ON "Page"("slug");
CREATE INDEX "Page_status_idx" ON "Page"("status");
