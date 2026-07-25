-- Phase 3 (Wave 4): programmatic API keys for sellers/admins.
--
-- The "ApiKey" table already exists as a never-used identity stub (created in
-- 20260404142331_sprint1_identity with columns userId + permissions JSON, and
-- an index added in 20260717173529_hotpath_indexes). It has never been written
-- to by any application code, so we ALTER it in place into the Wave-4 shape
-- rather than DROP/CREATE — non-destructive, and it keeps the existing FK to
-- "User" (renamed to reflect the new column name).
--
-- Matches prisma/schema/apikey.prisma. The unique keyPrefix backs the single-
-- row lookup in ApiKeyGuard/verify(); the hash+prefix are all that persist of a
-- key — the plaintext secret is returned to the caller exactly once and never
-- stored (see the model doc-comment for the security contract).

-- Rename the owner column (userId -> ownerUserId).
ALTER TABLE "ApiKey" RENAME COLUMN "userId" TO "ownerUserId";

-- Drop the freeform permissions JSON in favour of typed scope slugs.
ALTER TABLE "ApiKey" DROP COLUMN "permissions";
ALTER TABLE "ApiKey" ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Lifecycle columns absent from the stub.
ALTER TABLE "ApiKey" ADD COLUMN "lastUsedAt" TIMESTAMP(3);
ALTER TABLE "ApiKey" ADD COLUMN "expiresAt"  TIMESTAMP(3);
ALTER TABLE "ApiKey" ADD COLUMN "revokedAt"  TIMESTAMP(3);
ALTER TABLE "ApiKey" ADD COLUMN "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- keyPrefix becomes the public single-row lookup handle for verify(); make it
-- UNIQUE so authentication can resolve exactly one row before the hash compare.
CREATE UNIQUE INDEX "ApiKey_keyPrefix_key" ON "ApiKey"("keyPrefix");

-- Rename the FK constraint + owner index to match the new column name.
ALTER TABLE "ApiKey" RENAME CONSTRAINT "ApiKey_userId_fkey" TO "ApiKey_ownerUserId_fkey";
ALTER INDEX "ApiKey_userId_idx" RENAME TO "ApiKey_ownerUserId_idx";
