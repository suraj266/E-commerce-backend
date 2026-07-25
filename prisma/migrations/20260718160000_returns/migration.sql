-- Phase 3 (P3-02): Returns / RMA lifecycle + payout clawback carry-forward.
-- Additive-only and safe to apply to existing data.
--
-- Creates the ReturnRequest state machine (+ ReturnItem / ReturnEvent children)
-- and the PayoutAdjustment carry-forward ledger, plus the Payout.clawbackAdjustment
-- column PayoutService nets out at settlement. Prisma cannot model CHECK
-- constraints or partial unique indexes, so those are authored here (each is
-- doc-commented on its model in return.prisma / payout.prisma).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "ReturnStatus" AS ENUM (
    'REQUESTED', 'APPROVED', 'PICKUP_SCHEDULED', 'IN_TRANSIT', 'RECEIVED',
    'QC_PASSED', 'QC_FAILED', 'REFUNDED', 'CLOSED', 'REJECTED'
);
CREATE TYPE "ReturnResolutionType"   AS ENUM ('REFUND', 'REPLACEMENT');
CREATE TYPE "PayoutAdjustmentKind"   AS ENUM ('RETURN_CLAWBACK');
CREATE TYPE "PayoutAdjustmentStatus" AS ENUM ('PENDING', 'APPLIED', 'VOID');

-- ---------------------------------------------------------------------------
-- ReturnRequest — one customer return against one delivered SellerOrder.
-- Scalar FK columns only (no FK constraints) — canonical for a cross-domain
-- lifecycle row, mirrors TcsLedger.
-- ---------------------------------------------------------------------------
CREATE TABLE "ReturnRequest" (
    "id"                     TEXT NOT NULL,
    "returnNumber"           TEXT NOT NULL,
    "orderId"                TEXT NOT NULL,
    "sellerOrderId"          TEXT NOT NULL,
    "sellerId"               TEXT NOT NULL,
    "storeId"                TEXT NOT NULL,
    "customerId"             TEXT NOT NULL,
    "status"                 "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "resolutionType"         "ReturnResolutionType" NOT NULL DEFAULT 'REFUND',
    "reason"                 TEXT NOT NULL,
    "customerNote"           TEXT,
    "qcNote"                 TEXT,
    "rejectionReason"        TEXT,
    "reverseAwb"             TEXT,
    "reverseShipmentId"      TEXT,
    "reverseProviderOrderId" TEXT,
    "reverseLabelUrl"        TEXT,
    "reverseProvider"        VARCHAR(20),
    "refundId"               TEXT,
    "refundAmount"           DECIMAL(10,2),
    "requestedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt"             TIMESTAMP(3),
    "pickupScheduledAt"      TIMESTAMP(3),
    "inTransitAt"            TIMESTAMP(3),
    "receivedAt"             TIMESTAMP(3),
    "qcPassedAt"             TIMESTAMP(3),
    "qcFailedAt"             TIMESTAMP(3),
    "refundedAt"             TIMESTAMP(3),
    "closedAt"               TIMESTAMP(3),
    "rejectedAt"             TIMESTAMP(3),
    "approvedById"           TEXT,
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReturnRequest_returnNumber_key" ON "ReturnRequest"("returnNumber");
CREATE INDEX "ReturnRequest_orderId_idx"          ON "ReturnRequest"("orderId");
CREATE INDEX "ReturnRequest_sellerOrderId_idx"    ON "ReturnRequest"("sellerOrderId");
CREATE INDEX "ReturnRequest_sellerId_status_idx"  ON "ReturnRequest"("sellerId", "status");
CREATE INDEX "ReturnRequest_customerId_idx"       ON "ReturnRequest"("customerId");
CREATE INDEX "ReturnRequest_status_idx"           ON "ReturnRequest"("status");
-- The courier webhook correlates a reverse scan back to a return by AWB.
CREATE INDEX "ReturnRequest_reverseAwb_idx"       ON "ReturnRequest"("reverseAwb");

-- ---------------------------------------------------------------------------
-- ReturnItem — a quantity-bounded slice of an OrderItem.
-- ---------------------------------------------------------------------------
CREATE TABLE "ReturnItem" (
    "id"              TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "orderItemId"     TEXT NOT NULL,
    "quantity"        INTEGER NOT NULL,
    "condition"       TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReturnItem_returnRequestId_idx" ON "ReturnItem"("returnRequestId");
CREATE INDEX "ReturnItem_orderItemId_idx"     ON "ReturnItem"("orderItemId");

-- A returned line must move at least one unit.
ALTER TABLE "ReturnItem"
    ADD CONSTRAINT "return_item_qty_positive" CHECK ("quantity" > 0);

ALTER TABLE "ReturnItem"
    ADD CONSTRAINT "ReturnItem_returnRequestId_fkey"
    FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ReturnEvent — append-only ReturnStatus transition trail.
-- ---------------------------------------------------------------------------
CREATE TABLE "ReturnEvent" (
    "id"              TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "fromStatus"      "ReturnStatus",
    "toStatus"        "ReturnStatus" NOT NULL,
    "note"            TEXT,
    "actorUserId"     TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReturnEvent_returnRequestId_createdAt_idx"
    ON "ReturnEvent"("returnRequestId", "createdAt");

ALTER TABLE "ReturnEvent"
    ADD CONSTRAINT "ReturnEvent_returnRequestId_fkey"
    FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- PayoutAdjustment — carry-forward clawback ledger (nets out of next payout).
-- ---------------------------------------------------------------------------
CREATE TABLE "PayoutAdjustment" (
    "id"            TEXT NOT NULL,
    "sellerId"      TEXT NOT NULL,
    "sellerOrderId" TEXT,
    "returnId"      TEXT,
    "refundId"      TEXT,
    "kind"          "PayoutAdjustmentKind" NOT NULL DEFAULT 'RETURN_CLAWBACK',
    "status"        "PayoutAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "amount"        DECIMAL(10,2) NOT NULL,
    "description"   TEXT,
    "payoutId"      TEXT,
    "createdById"   TEXT,
    "appliedAt"     TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayoutAdjustment_sellerId_status_idx" ON "PayoutAdjustment"("sellerId", "status");
CREATE INDEX "PayoutAdjustment_returnId_idx"        ON "PayoutAdjustment"("returnId");
CREATE INDEX "PayoutAdjustment_payoutId_idx"        ON "PayoutAdjustment"("payoutId");

-- Idempotent clawback creation: at most one RETURN_CLAWBACK per return. A
-- retried QC_PASSED is a no-op via createMany({ skipDuplicates:true }).
CREATE UNIQUE INDEX "PayoutAdjustment_return_clawback_unique"
    ON "PayoutAdjustment"("returnId")
    WHERE "kind" = 'RETURN_CLAWBACK' AND "returnId" IS NOT NULL;

-- A clawback magnitude is a non-negative amount to deduct (sign applied in code).
ALTER TABLE "PayoutAdjustment"
    ADD CONSTRAINT "payout_adjustment_amount_nonneg" CHECK ("amount" >= 0);

-- SetNull so a carried-forward adjustment survives its run being deleted/failed.
ALTER TABLE "PayoutAdjustment"
    ADD CONSTRAINT "PayoutAdjustment_payoutId_fkey"
    FOREIGN KEY ("payoutId") REFERENCES "Payout"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Payout.clawbackAdjustment (lives in payout.prisma, which P3-02 also edits;
-- hand-authored ALTER here since Prisma migrate is run centrally).
-- ---------------------------------------------------------------------------
ALTER TABLE "Payout" ADD COLUMN "clawbackAdjustment" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Clawback absorbed is never negative (greedy netting is floored in code).
ALTER TABLE "Payout"
    ADD CONSTRAINT "payout_clawback_nonneg" CHECK ("clawbackAdjustment" >= 0);
