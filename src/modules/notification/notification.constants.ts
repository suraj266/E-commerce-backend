/**
 * Notification-area constants (Phase 4, notification depth).
 *
 * Kept in the notification module (not outbox.constants.ts) so this wave adds no
 * edit to the shared outbox constants file: the back-in-stock event routes on the
 * existing EMAILS queue, and its `type` string is switched on centrally by
 * EmailsProcessor which imports this constant.
 */

/** Outbox event types owned by the notification module. */
export const NOTIFICATION_OUTBOX_EVENT = {
  /**
   * Wishlist back-in-stock alert. Enqueued (deduped, in-tx with the
   * BackInStockAlert ledger row) by BackInStockService.runSweep; handled on the
   * EMAILS queue by EmailsProcessor → BackInStockService.sendBackInStockAlert,
   * which writes the in-app bell (auto-fanning SMS/push) + sends the email.
   */
  BACK_IN_STOCK: 'notification.back_in_stock',
} as const;

/** Notification `type` values this module introduces. */
export const NOTIFICATION_TYPE = {
  BACK_IN_STOCK: 'back_in_stock',
} as const;

/**
 * MARKETING-class notification kinds. SMS to these requires explicit marketing
 * consent (Customer.marketingOptIn) AND is suppressed during quiet hours; every
 * OTHER kind (order / shipping / return / refund / seller / courier) is
 * TRANSACTIONAL and sends without those gates — the DLT/TRAI distinction.
 *
 * Web-Push is exempt from these gates: a browser push subscription is itself an
 * explicit per-device opt-in.
 */
export const MARKETING_NOTIFICATION_TYPES: ReadonlySet<string> = new Set<string>([
  NOTIFICATION_TYPE.BACK_IN_STOCK,
]);

/** True when `type` is marketing-class (consent + quiet-hours gated for SMS). */
export function isMarketingNotificationType(type: string): boolean {
  return MARKETING_NOTIFICATION_TYPES.has(type);
}
