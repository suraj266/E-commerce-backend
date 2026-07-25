/**
 * Constants for the newsletter double opt-in flow (P3-08).
 */

/**
 * Email template key for the double opt-in confirmation email (the "click to
 * confirm your subscription" mail). Seeded in emailTemplates.seed.ts — a send is
 * a soft no-op (skipped) if the template is missing/disabled, so a subscribe
 * never hard-fails on template state.
 */
export const NEWSLETTER_CONFIRM_TEMPLATE = 'newsletter_confirm';

/**
 * How long a confirmation token stays valid. A PENDING subscription whose token
 * has expired can never be confirmed — the subscriber must re-subscribe (which
 * mints a fresh token + email).
 */
export const NEWSLETTER_CONFIRM_TTL_HOURS = 48;

/** Path on the storefront that handles the confirmation link (token in query). */
export const NEWSLETTER_CONFIRM_PATH = '/newsletter/confirm';

// -----------------------------------------------------------------------------
// Broadcast campaign (P3 Wave 4)
// -----------------------------------------------------------------------------

/**
 * Email template key for the campaign body WRAPPER. Its subject is `{{subject}}`
 * and its body injects the admin-authored HTML verbatim ({{{body}}}) plus an
 * unsubscribe line ({{unsubscribeLink}}); the shared header/footer partials wrap
 * it like every other email. Seeded centrally (report) — a missing/disabled
 * template makes a send a soft no-op (skipped), never a hard failure.
 */
export const NEWSLETTER_CAMPAIGN_TEMPLATE = 'newsletter_campaign';

/** Storefront path that handles the one-click unsubscribe link (token in query). */
export const NEWSLETTER_UNSUBSCRIBE_PATH = '/newsletter/unsubscribe';

/**
 * How many ACTIVE subscribers the fan-out loads per batch. Each batch is one
 * consent-filter pass + one transaction of recipient rows + delivery enqueues.
 */
export const NEWSLETTER_CAMPAIGN_BATCH_SIZE = 200;
