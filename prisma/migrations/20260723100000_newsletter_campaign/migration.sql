-- Phase 3 Wave 4: consent-gated newsletter BROADCAST (NewsletterCampaign).
-- Additive-only and safe on existing data:
--   * the new NewsletterSubscription.unsubscribeToken column is nullable (minted
--     lazily at first broadcast delivery), so existing rows are untouched;
--   * two brand-new tables + their enums.
-- No CHECK/trigger needed — no money and no invariant beyond the enums + the
-- per-(campaign,subscriber) unique that gives the fan-out at-most-once-enqueue.

-- Enums -----------------------------------------------------------------------
CREATE TYPE "NewsletterAudience" AS ENUM ('ACTIVE_SUBSCRIBERS');
CREATE TYPE "NewsletterCampaignStatus" AS ENUM ('DRAFT', 'SENDING', 'SENT');
CREATE TYPE "NewsletterCampaignRecipientStatus" AS ENUM ('QUEUED', 'SENT', 'SKIPPED');

-- Stable, unguessable per-subscriber unsubscribe token (embedded in every
-- broadcast email's unsubscribe link). Nullable + @unique — multiple NULLs are
-- allowed by Postgres, so unsubscribed/never-broadcast rows coexist fine.
ALTER TABLE "NewsletterSubscription" ADD COLUMN "unsubscribeToken" TEXT;
CREATE UNIQUE INDEX "NewsletterSubscription_unsubscribeToken_key" ON "NewsletterSubscription"("unsubscribeToken");

-- Campaign --------------------------------------------------------------------
CREATE TABLE "NewsletterCampaign" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "htmlBody" TEXT NOT NULL,
    "audience" "NewsletterAudience" NOT NULL DEFAULT 'ACTIVE_SUBSCRIBERS',
    "status" "NewsletterCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "sendStartedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsletterCampaign_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NewsletterCampaign_status_createdAt_idx" ON "NewsletterCampaign"("status", "createdAt");

-- Per-(campaign, subscriber) delivery ledger ----------------------------------
-- subscriptionId is a SOFT reference (no FK) so a subscriber deletion never
-- cascades away broadcast history; the delivery handler re-reads + no-ops.
CREATE TABLE "NewsletterCampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "NewsletterCampaignRecipientStatus" NOT NULL DEFAULT 'QUEUED',
    "skipReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsletterCampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- The fan-out's idempotency anchor: one row per (campaign, subscriber). Combined
-- with the outbox dedupeKey, a crash/redelivery never double-enqueues a send.
CREATE UNIQUE INDEX "NewsletterCampaignRecipient_campaignId_subscriptionId_key" ON "NewsletterCampaignRecipient"("campaignId", "subscriptionId");
CREATE INDEX "NewsletterCampaignRecipient_campaignId_status_idx" ON "NewsletterCampaignRecipient"("campaignId", "status");

ALTER TABLE "NewsletterCampaignRecipient"
    ADD CONSTRAINT "NewsletterCampaignRecipient_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "NewsletterCampaign"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
