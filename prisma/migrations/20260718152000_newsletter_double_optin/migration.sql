-- Phase 3 (P3-08): newsletter double opt-in — token columns + PENDING default.
-- Additive-only and safe to apply to existing data (all new columns nullable).
--
-- The 'PENDING' enum value was added + committed in the prior migration
-- (20260718151000_newsletter_pending_enum), so referencing it as the new column
-- default here is safe (it is no longer "used in the same transaction it was
-- added").

-- Single-use double opt-in token (+ expiry) and the confirmation timestamp.
ALTER TABLE "NewsletterSubscription" ADD COLUMN "confirmToken" TEXT;
ALTER TABLE "NewsletterSubscription" ADD COLUMN "confirmTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "NewsletterSubscription" ADD COLUMN "confirmedAt" TIMESTAMP(3);

-- Unguessable O(1) lookup for the public confirmNewsletter(token) mutation.
CREATE UNIQUE INDEX "NewsletterSubscription_confirmToken_key" ON "NewsletterSubscription"("confirmToken");

-- New signups now start PENDING (double opt-in). Existing rows are untouched —
-- only the DB-level default for future inserts changes.
ALTER TABLE "NewsletterSubscription" ALTER COLUMN "status" SET DEFAULT 'PENDING';
