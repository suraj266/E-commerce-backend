-- Phase 3 Wave 4 (Agent A): Returns REPLACEMENT arm + COD manual-refund support.
--
-- Additive-only and safe to apply to existing data:
--   1. Two new ReturnStatus enum values for the replacement lifecycle.
--   2. Three ReturnRequest columns backing the REPLACEMENT arm.
--
-- Postgres forbids USING a newly-added enum value in the SAME transaction that
-- adds it. This migration never references the new values (no default flip, no
-- data backfill onto them), so adding them and the columns together is safe.
-- IF NOT EXISTS keeps a re-run idempotent (mirrors the newsletter_pending_enum
-- convention).

-- ---------------------------------------------------------------------------
-- ReturnStatus — replacement lifecycle states.
-- ---------------------------------------------------------------------------
ALTER TYPE "ReturnStatus" ADD VALUE IF NOT EXISTS 'REPLACEMENT_APPROVED';
ALTER TYPE "ReturnStatus" ADD VALUE IF NOT EXISTS 'REPLACEMENT_SHIPPED';

-- ---------------------------------------------------------------------------
-- ReturnRequest — replacement linkage (REPLACEMENT arm only; NULL for REFUND).
-- ---------------------------------------------------------------------------
ALTER TABLE "ReturnRequest"
    ADD COLUMN IF NOT EXISTS "replacementReference"  TEXT,
    ADD COLUMN IF NOT EXISTS "replacementApprovedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "replacementShippedAt"  TIMESTAMP(3);
