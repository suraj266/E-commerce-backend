-- Phase 3 (P3-01): durable transactional outbox.
-- Additive-only and safe to apply to existing data.

-- Outbox row lifecycle.
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- The outbox table. A row is inserted INSIDE the business transaction that
-- caused the side effect (OutboxService.enqueue), so intent commits atomically
-- with state. The relay poller claims PENDING+due rows and dispatches them to
-- BullMQ; workers mark DONE / retry (attempts + nextRunAt) / park FAILED.
CREATE TABLE "OutboxEvent" (
    "id"            TEXT NOT NULL,
    "type"          TEXT NOT NULL,
    "payload"       JSONB NOT NULL,
    "status"        "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts"      INTEGER NOT NULL DEFAULT 0,
    "maxAttempts"   INTEGER NOT NULL DEFAULT 8,
    "nextRunAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupeKey"     TEXT,
    "lastError"     TEXT,
    "correlationId" TEXT,
    "queue"         TEXT NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    "processedAt"   TIMESTAMP(3),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- Idempotent enqueue: a second enqueue with the same logical key is skipped
-- (createMany + skipDuplicates → ON CONFLICT DO NOTHING). NULL keys never
-- collide, so events without a dedupeKey are always inserted.
CREATE UNIQUE INDEX "OutboxEvent_dedupeKey_key" ON "OutboxEvent"("dedupeKey");

-- Backs the relay claim scan: WHERE status = 'PENDING' AND "nextRunAt" <= now()
-- ORDER BY "nextRunAt".
CREATE INDEX "OutboxEvent_status_nextRunAt_idx" ON "OutboxEvent"("status", "nextRunAt");
