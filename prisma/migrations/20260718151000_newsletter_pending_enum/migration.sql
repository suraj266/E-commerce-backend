-- Phase 3 (P3-08): newsletter double opt-in — add the PENDING status.
--
-- Adding the new enum value lives in its OWN migration, applied + committed
-- before any migration that USES the value (see the sibling
-- 20260718152000_newsletter_double_optin, which sets it as the column default).
-- Postgres forbids using a newly-added enum value in the same transaction that
-- adds it, so the split is required for the default flip to be safe.
ALTER TYPE "NewsletterStatus" ADD VALUE IF NOT EXISTS 'PENDING';
