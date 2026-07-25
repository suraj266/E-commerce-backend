-- Phase 3 (P3-08): in-app Notification feed.
-- Additive-only and safe to apply to existing data.

-- One row per in-app notification (the notification-bell feed). Rows are written
-- best-effort ALONGSIDE the lifecycle emails from inside the outbox worker
-- handlers, so a notification shares its email's at-least-once + retry
-- guarantees. `dedupeKey` (UNIQUE below) makes those worker writes idempotent
-- under redelivery: NotificationService.create() uses createMany + skipDuplicates
-- (→ ON CONFLICT DO NOTHING) so a redelivered job never duplicates a bell entry.
CREATE TABLE "Notification" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "type"      TEXT NOT NULL,
    "title"     TEXT NOT NULL,
    "body"      TEXT NOT NULL,
    "data"      JSONB,
    "dedupeKey" TEXT,
    "readAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- Idempotency guarantee for worker-created notifications. A NULL dedupeKey is
-- treated as DISTINCT by Postgres, so ad-hoc notifications without a dedupe
-- identity still insert freely.
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- Feed read path: newest-first per user (myNotifications).
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
-- Unread-count read path: unread rows per user (unreadNotificationCount).
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
