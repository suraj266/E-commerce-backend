-- Phase 3 (P3-07): DPDP Act 2023 — erasure (anonymization), data export, consent.
-- Additive-only and safe to apply to existing data.
--
-- Three tables + four enums, plus a DB-level APPEND-ONLY trigger on
-- "ConsentRecord". Prisma cannot model triggers, so the append-only guarantee
-- is hand-authored here (mirrors the CHECK-constraint pattern in
-- 20260717170000_refund_payout_check_constraints). The matching .prisma models
-- document these DB-only guards.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Consent taxonomy. 👤 NEEDS LEGAL SIGN-OFF on the purpose set.
CREATE TYPE "ConsentPurpose" AS ENUM (
  'MARKETING_EMAIL',
  'MARKETING_SMS',
  'PROFILING_PERSONALIZATION',
  'THIRD_PARTY_SHARING'
);

CREATE TYPE "DataExportStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'READY',
  'EXPIRED',
  'FAILED'
);

CREATE TYPE "AccountDeletionStatus" AS ENUM (
  'PENDING',
  'GRACE',
  'ANONYMIZED',
  'CANCELLED'
);

-- ---------------------------------------------------------------------------
-- ConsentRecord — append-only consent ledger
-- ---------------------------------------------------------------------------
CREATE TABLE "ConsentRecord" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "purpose"   "ConsentPurpose" NOT NULL,
    "granted"   BOOLEAN NOT NULL,
    "source"    TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- Backs canMarket(): newest row for a (userId, purpose).
CREATE INDEX "ConsentRecord_userId_purpose_createdAt_idx"
  ON "ConsentRecord"("userId", "purpose", "createdAt");

-- APPEND-ONLY ENFORCEMENT.
-- A consent ledger is only defensible if rows are immutable. This trigger
-- rejects every UPDATE and DELETE at the database, so no application bug (or
-- future careless migration/code path) can rewrite or erase consent history.
-- A change of mind is recorded as a NEW row, never an edit.
CREATE OR REPLACE FUNCTION "consent_record_append_only"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ConsentRecord is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "consent_record_no_mutate"
  BEFORE UPDATE OR DELETE ON "ConsentRecord"
  FOR EACH ROW EXECUTE FUNCTION "consent_record_append_only"();

-- ---------------------------------------------------------------------------
-- DataExportRequest — right to data portability
-- ---------------------------------------------------------------------------
CREATE TABLE "DataExportRequest" (
    "id"          TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "status"      "DataExportStatus" NOT NULL DEFAULT 'PENDING',
    "fileUrl"     TEXT,
    "expiresAt"   TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataExportRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DataExportRequest_userId_createdAt_idx"
  ON "DataExportRequest"("userId", "createdAt");
CREATE INDEX "DataExportRequest_status_idx"
  ON "DataExportRequest"("status");

-- ---------------------------------------------------------------------------
-- AccountDeletionRequest — right to erasure (via anonymization)
-- ---------------------------------------------------------------------------
CREATE TABLE "AccountDeletionRequest" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "status"       "AccountDeletionStatus" NOT NULL DEFAULT 'GRACE',
    "requestedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executeAfter" TIMESTAMP(3) NOT NULL,
    "anonymizedAt" TIMESTAMP(3),
    "cancelledAt"  TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- Backs the erasure cron claim: WHERE status = 'GRACE' AND "executeAfter" <= now().
CREATE INDEX "AccountDeletionRequest_status_executeAfter_idx"
  ON "AccountDeletionRequest"("status", "executeAfter");
CREATE INDEX "AccountDeletionRequest_userId_createdAt_idx"
  ON "AccountDeletionRequest"("userId", "createdAt");
