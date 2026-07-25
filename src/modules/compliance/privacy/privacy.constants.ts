/**
 * Legal + operational constants for the DPDP privacy module (P3-07).
 *
 * Every value here has legal consequences. The flagged constants MUST be
 * reviewed and signed off by Legal before this module runs in production —
 * they are our current best-guess defaults, not settled policy.
 */

/**
 * Cooling-off window between an account-deletion request and the irreversible
 * anonymization scrub. During this window the principal can cancel (protects
 * against mistakes and account-takeover-triggered deletions).
 *
 * // NEEDS LEGAL SIGN-OFF: 30 days is a common cooling-off default but is not
 * // mandated by the DPDP Act — Legal must confirm the window (and whether a
 * // shorter/longer period applies to specific data categories).
 */
export const DELETION_GRACE_DAYS = 30;

/**
 * Lifetime of the signed, time-limited download URL emailed for a data export.
 * After this the URL 404s / 403s and the principal must request a fresh export.
 *
 * // NEEDS LEGAL SIGN-OFF: how long a generated export bundle (which contains a
 * // full copy of the principal's personal data) may remain retrievable. Short
 * // by default to minimize the exposure window of the bundle.
 */
export const EXPORT_URL_TTL_HOURS = 48;

/**
 * The purposes canMarket() and the /account/privacy page treat as "marketing".
 * v1 wires only MARKETING_EMAIL into a live gate.
 *
 * // NEEDS LEGAL SIGN-OFF: the consent taxonomy (which purposes we track, their
 * // legal basis) AND whether pre-existing customers must actively re-consent
 * // before we may treat a legacy `Customer.marketingOptIn` as valid consent.
 */
export const MARKETING_CONSENT_PURPOSE = 'MARKETING_EMAIL' as const;

/** Where a consent decision made on the storefront privacy page originates. */
export const CONSENT_SOURCE_PRIVACY_PAGE = 'account_privacy_page';

/**
 * S3 key prefix for generated export bundles. Kept separate from invoices/media
 * so a lifecycle rule can auto-expire export bundles independently.
 */
export const EXPORT_S3_PREFIX = 'data-exports';

/**
 * Tombstone values written by the anonymization scrub. Centralized so the
 * scrub, its dry-run preview, and the idempotency check all agree on the exact
 * sentinels. `email` is templated per-user to preserve the UNIQUE constraint.
 *
 * `.invalid` is a reserved TLD (RFC 6761) that can never resolve or receive
 * mail — a tombstone email is guaranteed dead.
 */
export const ANONYMIZED_EMAIL_DOMAIN = 'anonymized.invalid';
export const TOMBSTONE = {
  NAME: 'Deleted User',
  ADDRESS_NAME: 'Deleted',
  REDACTED: 'REDACTED',
} as const;

/** Builds the per-user tombstone email (unique + non-routable). */
export function anonymizedEmail(userId: string): string {
  return `deleted+${userId}@${ANONYMIZED_EMAIL_DOMAIN}`;
}

/**
 * The email template key the export worker sends. The template itself is
 * seeded centrally (see CENTRAL-WIRING TODO — emailTemplates.seed.ts is NOT
 * owned by this workstream).
 */
export const EXPORT_READY_EMAIL_TEMPLATE = 'data_export_ready';

/**
 * Dedicated outbox event type for the data-export job. Follows the
 * `<queue>.<verb>` convention. The matching constant + processor case are added
 * to the shared outbox files centrally (see CENTRAL-WIRING TODO) — this literal
 * is passed at the enqueue site so producer + consumer agree on the string.
 */
export const PRIVACY_OUTBOX_EVENT = {
  DATA_EXPORT: 'privacy.data_export',
} as const;
