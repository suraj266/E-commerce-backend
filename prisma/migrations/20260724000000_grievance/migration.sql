-- Phase 4 (P4-01): Grievance / complaint-redressal workflow (CP-EC Rules 2020).
-- Additive-only and safe to apply to existing data.
--
-- Creates the Grievance state machine (+ GrievanceMessage thread child). Scalar
-- FK columns only for the cross-domain links (raisedByUserId / orderId /
-- sellerOrderId / assignedToUserId) — no FK constraints — the canonical shape for
-- a cross-domain lifecycle row (mirrors TcsLedger / ReturnRequest). Prisma cannot
-- model CHECK constraints or partial indexes, so those are authored here (each is
-- doc-commented on its model in grievance.prisma).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "GrievanceCategory" AS ENUM (
    'ORDER_ISSUE', 'DELIVERY', 'PAYMENT', 'REFUND',
    'PRODUCT_QUALITY', 'SELLER_CONDUCT', 'DATA_PRIVACY', 'OTHER'
);
CREATE TYPE "GrievanceStatus" AS ENUM (
    'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'ESCALATED'
);
CREATE TYPE "GrievancePriority"   AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "GrievanceAuthorRole" AS ENUM ('CUSTOMER', 'OFFICER', 'SYSTEM');

-- ---------------------------------------------------------------------------
-- Grievance — one customer complaint on the CP-EC redressal workflow.
-- ---------------------------------------------------------------------------
CREATE TABLE "Grievance" (
    "id"               TEXT NOT NULL,
    "ticketNumber"     TEXT NOT NULL,
    "raisedByUserId"   TEXT,
    "contactName"      TEXT,
    "contactEmail"     TEXT,
    "orderId"          TEXT,
    "sellerOrderId"    TEXT,
    "category"         "GrievanceCategory" NOT NULL,
    "subject"          TEXT NOT NULL,
    "description"      TEXT NOT NULL,
    "status"           "GrievanceStatus" NOT NULL DEFAULT 'OPEN',
    "priority"         "GrievancePriority" NOT NULL DEFAULT 'NORMAL',
    "slaDueAt"         TIMESTAMP(3) NOT NULL,
    "assignedToUserId" TEXT,
    "resolutionNote"   TEXT,
    "firstResponseAt"  TIMESTAMP(3),
    "escalatedAt"      TIMESTAMP(3),
    "resolvedAt"       TIMESTAMP(3),
    "closedAt"         TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Grievance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Grievance_ticketNumber_key" ON "Grievance"("ticketNumber");
CREATE INDEX "Grievance_raisedByUserId_idx"   ON "Grievance"("raisedByUserId");
CREATE INDEX "Grievance_status_idx"           ON "Grievance"("status");
CREATE INDEX "Grievance_assignedToUserId_idx" ON "Grievance"("assignedToUserId");
CREATE INDEX "Grievance_category_idx"         ON "Grievance"("category");
CREATE INDEX "Grievance_slaDueAt_idx"         ON "Grievance"("slaDueAt");
CREATE INDEX "Grievance_orderId_idx"          ON "Grievance"("orderId");
CREATE INDEX "Grievance_createdAt_idx"        ON "Grievance"("createdAt");

-- Partial index (Prisma cannot model partial indexes). The SLA-breach cron scans
-- only still-open tickets past their due date; this keeps that hot scan cheap and
-- out of the way of resolved/closed history.
CREATE INDEX "Grievance_open_sla_idx"
    ON "Grievance"("slaDueAt")
    WHERE "status" IN ('OPEN', 'IN_PROGRESS');

-- ---------------------------------------------------------------------------
-- GrievanceMessage — append-only conversation thread (customer / officer / system).
-- ---------------------------------------------------------------------------
CREATE TABLE "GrievanceMessage" (
    "id"           TEXT NOT NULL,
    "grievanceId"  TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorRole"   "GrievanceAuthorRole" NOT NULL,
    "body"         TEXT NOT NULL,
    "internal"     BOOLEAN NOT NULL DEFAULT false,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrievanceMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GrievanceMessage_grievanceId_createdAt_idx"
    ON "GrievanceMessage"("grievanceId", "createdAt");

-- A thread message must carry text (Prisma cannot model CHECK constraints).
ALTER TABLE "GrievanceMessage"
    ADD CONSTRAINT "grievance_message_body_not_empty" CHECK ("body" <> '');

ALTER TABLE "GrievanceMessage"
    ADD CONSTRAINT "GrievanceMessage_grievanceId_fkey"
    FOREIGN KEY ("grievanceId") REFERENCES "Grievance"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
