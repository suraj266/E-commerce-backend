/**
 * Shared names + tokens for the durable transactional outbox (P3-01).
 *
 * Keeping the queue names + event types in one place stops a producer
 * (`OutboxService.enqueue`) and its consumer (a `WorkerHost` processor) from
 * silently drifting apart on a string typo.
 */

/** BullMQ named queues. `OutboxEvent.queue` must be one of these. */
export const OUTBOX_QUEUE = {
  INVOICES: 'invoices',
  EMAILS: 'emails',
  COURIER: 'courier',
  CART: 'cart',
} as const;

export type OutboxQueue = (typeof OUTBOX_QUEUE)[keyof typeof OUTBOX_QUEUE];

/** All queue names, for BullModule.registerQueue + the relay's dispatch map. */
export const OUTBOX_QUEUE_NAMES: OutboxQueue[] = Object.values(OUTBOX_QUEUE);

/**
 * Dot-namespaced event types = `OutboxEvent.type`. The `<queue>.<verb>` shape
 * routes an event to its queue's processor, which switches on the exact type.
 */
export const OUTBOX_EVENT = {
  INVOICE_GENERATE: 'invoice.generate',
  CART_CLEAR: 'cart.clear',
  EMAIL_ORDER_PLACED: 'email.order_placed',
  EMAIL_SELLER_NEW_ORDER: 'email.seller_new_order',
  EMAIL_ORDER_REFUNDED: 'email.order_refunded',
  EMAIL_SELLER_KYC_APPROVED: 'email.seller_kyc_approved',
  EMAIL_SELLER_KYC_REJECTED: 'email.seller_kyc_rejected',
  // P3-11: NDR/RTO courier exception alert. Routed on the COURIER queue (handled
  // by CourierProcessor), even though the side effect is an email — the queue is
  // just the transport lane; the courier queue isolates courier-domain retries.
  EMAIL_COURIER_ALERT: 'email.courier_alert',
  // P3-07 (DPDP): "your data export is ready" — builds a signed expiring URL then
  // emails it. On the EMAILS queue (handled by EmailsProcessor).
  PRIVACY_DATA_EXPORT: 'privacy.data_export',
  // P3-03 (TCS): monthly deposit reminder to ops before the by-10th deadline.
  // On the EMAILS queue (handled by EmailsProcessor).
  TCS_DEPOSIT_REMINDER: 'email.tcs_deposit_reminder',
  // P3-08 (newsletter double opt-in): "confirm your subscription" email. On the
  // EMAILS queue (handled by EmailsProcessor → NewsletterService).
  NEWSLETTER_CONFIRM: 'newsletter.confirm',
  // P3 Wave 4 (newsletter broadcast): fan-out ORCHESTRATION for one campaign —
  // iterates ACTIVE subscribers in batches, applies the DPDP consent gate, and
  // enqueues one NEWSLETTER_CAMPAIGN_DELIVER per surviving recipient. On the
  // EMAILS queue (handled by EmailsProcessor → NewsletterService.dispatchCampaign).
  NEWSLETTER_CAMPAIGN_SEND: 'newsletter.campaign_send',
  // P3 Wave 4: per-recipient broadcast delivery (re-checks the recipient is still
  // ACTIVE, then sends the wrapped campaign email with an unsubscribe link). On
  // the EMAILS queue (handled by EmailsProcessor → NewsletterService.deliverCampaignEmail).
  NEWSLETTER_CAMPAIGN_DELIVER: 'newsletter.campaign_deliver',
  // P3-02 (returns): customer lifecycle comms — each also writes an in-app bell.
  // On the EMAILS queue (handled by EmailsProcessor → ReturnsService).
  EMAIL_RETURN_APPROVED: 'email.return_approved',
  EMAIL_RETURN_RECEIVED: 'email.return_received',
  EMAIL_RETURN_REFUNDED: 'email.return_refunded',
  // P3 Wave-4 (returns REPLACEMENT arm). Values match returns.constants
  // RETURN_OUTBOX_EVENT literals used at the enqueue sites.
  EMAIL_RETURN_REPLACEMENT_APPROVED: 'email.return_replacement_approved',
  EMAIL_RETURN_REPLACEMENT_SHIPPED: 'email.return_replacement_shipped',
  // P4 (CP-EC grievance). Values match grievance.constants GRIEVANCE_OUTBOX_EVENT.
  EMAIL_GRIEVANCE_FILED: 'email.grievance_filed',
  EMAIL_GRIEVANCE_STATUS: 'email.grievance_status',
  EMAIL_GRIEVANCE_REPLY: 'email.grievance_reply',
} as const;

/** DI token for the shared ioredis client (used by BullMQ + the health check). */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
