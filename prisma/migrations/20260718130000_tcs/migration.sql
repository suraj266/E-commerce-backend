-- Phase 3 (P3-03): TCS §52 ledger + monthly deposit + seller-payout netting.
-- Additive-only and safe to apply to existing data.
--
-- This subsystem COMPUTES / LEDGERS / EXPORTS marketplace Tax-Collected-at-Source
-- only. The GSTR-8 filing + challan deposit remain a MANUAL CA action. Every
-- rate/threshold/base here is provisional — see tcs.constants.ts (// NEEDS CA SIGN-OFF).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "TcsLedgerKind"    AS ENUM ('ACCRUAL', 'REVERSAL');
CREATE TYPE "TcsDepositStatus" AS ENUM ('PENDING', 'DEPOSITED');

-- ---------------------------------------------------------------------------
-- TcsLedger — one row per accrual (capture / COD-confirm) and one per reversal
-- (finalized refund). Append-only in practice; amounts are signed (accrual >= 0,
-- reversal <= 0). No FK relations to Store/Seller/SellerOrder/Refund on purpose
-- (plain scalar keys — canonical ledger shape; avoids editing other schema files).
-- ---------------------------------------------------------------------------
CREATE TABLE "TcsLedger" (
    "id"              TEXT NOT NULL,
    "kind"            "TcsLedgerKind" NOT NULL,
    "period"          VARCHAR(7) NOT NULL,
    "storeId"         TEXT NOT NULL,
    "sellerId"        TEXT NOT NULL,
    "sellerOrderId"   TEXT NOT NULL,
    "refundId"        TEXT,
    "netTaxableValue" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "cgstTcs"         DECIMAL(14,4) NOT NULL DEFAULT 0,
    "sgstTcs"         DECIMAL(14,4) NOT NULL DEFAULT 0,
    "igstTcs"         DECIMAL(14,4) NOT NULL DEFAULT 0,
    "rateBps"         INTEGER NOT NULL,
    "taxKind"         VARCHAR(20) NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TcsLedger_pkey" PRIMARY KEY ("id")
);

-- Read paths: monthly roll-up (period), GSTR-8 supplier-wise (sellerId,period),
-- store-wise, and correlate-by-order / correlate-by-refund.
CREATE INDEX "TcsLedger_period_idx"           ON "TcsLedger"("period");
CREATE INDEX "TcsLedger_sellerId_period_idx"  ON "TcsLedger"("sellerId", "period");
CREATE INDEX "TcsLedger_storeId_period_idx"   ON "TcsLedger"("storeId", "period");
CREATE INDEX "TcsLedger_sellerOrderId_idx"    ON "TcsLedger"("sellerOrderId");
CREATE INDEX "TcsLedger_refundId_idx"         ON "TcsLedger"("refundId");

-- Idempotency (Prisma cannot model partial unique indexes). An accrual row has
-- refundId = NULL and Postgres treats NULLs as DISTINCT, so a plain unique on
-- (sellerOrderId, refundId) would NOT stop duplicate accruals. Two PARTIAL
-- uniques give the exact guarantee instead:
--   • at most one ACCRUAL per seller-order (a re-finalize is a no-op via
--     createMany skipDuplicates → ON CONFLICT DO NOTHING);
--   • at most one REVERSAL per (seller-order, refund).
CREATE UNIQUE INDEX "TcsLedger_accrual_unique"
    ON "TcsLedger"("sellerOrderId")
    WHERE "kind" = 'ACCRUAL';
CREATE UNIQUE INDEX "TcsLedger_reversal_unique"
    ON "TcsLedger"("sellerOrderId", "refundId")
    WHERE "kind" = 'REVERSAL';

-- Value-integrity CHECKs (Prisma cannot model CHECK constraints). Defence in
-- depth — the application already enforces these, but no code path may persist
-- an invalid ledger row.
--   Sign convention: an accrual only ever adds TCS, a reversal only ever removes.
ALTER TABLE "TcsLedger"
    ADD CONSTRAINT "tcs_ledger_sign" CHECK (
        ("kind" = 'ACCRUAL'
            AND "netTaxableValue" >= 0 AND "cgstTcs" >= 0 AND "sgstTcs" >= 0 AND "igstTcs" >= 0)
        OR
        ("kind" = 'REVERSAL'
            AND "netTaxableValue" <= 0 AND "cgstTcs" <= 0 AND "sgstTcs" <= 0 AND "igstTcs" <= 0)
    );
--   Shape: reversals must name their refund; accruals must not.
ALTER TABLE "TcsLedger"
    ADD CONSTRAINT "tcs_ledger_refund_shape" CHECK (
        ("kind" = 'ACCRUAL'  AND "refundId" IS NULL)
        OR
        ("kind" = 'REVERSAL' AND "refundId" IS NOT NULL)
    );
--   A zero/negative rate would silently ledger no tax.
ALTER TABLE "TcsLedger"
    ADD CONSTRAINT "tcs_ledger_rate_positive" CHECK ("rateBps" > 0);

-- ---------------------------------------------------------------------------
-- TcsDeposit — one obligation per YYYY-MM. Rolled up from the ledger, marked
-- DEPOSITED once finance files GSTR-8 + pays the challan.
-- ---------------------------------------------------------------------------
CREATE TABLE "TcsDeposit" (
    "id"              TEXT NOT NULL,
    "period"          VARCHAR(7) NOT NULL,
    "netTaxableValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgstTcs"         DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgstTcs"         DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igstTcs"         DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalTcs"        DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status"          "TcsDepositStatus" NOT NULL DEFAULT 'PENDING',
    "challanRef"      TEXT,
    "depositedById"   TEXT,
    "depositedAt"     TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TcsDeposit_pkey" PRIMARY KEY ("id")
);

-- One deposit row per period.
CREATE UNIQUE INDEX "TcsDeposit_period_key" ON "TcsDeposit"("period");
CREATE INDEX "TcsDeposit_status_idx" ON "TcsDeposit"("status");

-- ---------------------------------------------------------------------------
-- Seller-payout netting columns (live in payout.prisma, which P3-03 also edits;
-- hand-authored ALTER TABLE here since Prisma migrate is run centrally).
-- ---------------------------------------------------------------------------
ALTER TABLE "Payout"     ADD COLUMN "tcsAdjustment" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "PayoutItem" ADD COLUMN "tcsDeducted"   DECIMAL(10,2) NOT NULL DEFAULT 0;

-- TCS withheld is never negative (accrued-minus-reversed is floored at 0 in code).
ALTER TABLE "Payout"
    ADD CONSTRAINT "payout_tcs_nonneg" CHECK ("tcsAdjustment" >= 0);
ALTER TABLE "PayoutItem"
    ADD CONSTRAINT "payout_item_tcs_nonneg" CHECK ("tcsDeducted" >= 0);
