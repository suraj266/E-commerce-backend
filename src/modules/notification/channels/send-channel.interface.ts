/**
 * ISendChannel — the provider-abstracted "one more delivery channel" contract
 * behind the notification fan-out (Phase 4, notification depth).
 *
 * Email (EmailService) + the in-app bell (NotificationService) already exist
 * (P3-08). SMS + Web-Push are added as ADDITIONAL channels that a notification
 * fans out to. Each channel is a thin provider adapter that:
 *
 *   - is CONFIG-GATED: `isConfigured()` reflects whether provider credentials
 *     are present. When false the channel is a logged no-op — the whole system
 *     degrades gracefully with zero creds, exactly like EmailService without
 *     SMTP.
 *   - SOFT-FAILS: `send()` returns `{ sent:false, skipped:true }` when it
 *     deliberately no-ops and `{ sent:false, message }` on a transport error,
 *     but NEVER throws. The fan-out treats every channel as fire-and-forget, so
 *     one flaky provider can't fail (and thereby retry) the lifecycle handler.
 */

/** The extra delivery channels this wave adds on top of email + in-app bell. */
export const NOTIFICATION_CHANNEL = {
  SMS: 'SMS',
  WEB_PUSH: 'WEB_PUSH',
} as const;

export type NotificationChannel =
  (typeof NOTIFICATION_CHANNEL)[keyof typeof NOTIFICATION_CHANNEL];

/**
 * A rendered, channel-agnostic message. Built once by the fan-out from the
 * in-app notification and handed to every channel.
 */
export interface OutboundNotification {
  /** Notification kind, e.g. `order_placed` — for logs + provider templates. */
  type: string;
  /** Short headline. */
  title: string;
  /** One-line body. */
  body: string;
  /** App-relative (or absolute) deep-link the channel may attach (push URL). */
  url?: string;
  /** Structured context (ids) round-tripped into the push payload. */
  data?: Record<string, unknown>;
}

/** Soft-fail result of a single channel send (mirrors EmailService result). */
export interface ChannelSendResult {
  /** True only when the provider accepted the message. */
  sent: boolean;
  /** Deliberate no-op (provider unconfigured / recipient invalid). */
  skipped?: boolean;
  /** Skip reason, or the transport error message on a failed send. */
  message?: string;
  /**
   * Web-Push only: the subscription is gone (HTTP 404/410). The dispatcher
   * prunes it so a dead endpoint isn't retried forever.
   */
  expired?: boolean;
}

/**
 * One delivery channel. `TDestination` is the already-resolved recipient
 * address the dispatcher passes in (SMS: an E.164-ish phone string; Web-Push:
 * one stored browser subscription).
 */
export interface ISendChannel<TDestination = unknown> {
  readonly channel: NotificationChannel;

  /** True when provider credentials are present; false ⇒ `send()` no-ops. */
  isConfigured(): boolean;

  /**
   * Deliver one message to one resolved destination. Best-effort: returns a
   * soft-fail result and NEVER throws (see the file note).
   */
  send(
    destination: TDestination,
    message: OutboundNotification,
  ): Promise<ChannelSendResult>;
}

/** Web-Push destination = one stored browser subscription (endpoint + keys). */
export interface WebPushDestination {
  endpoint: string;
  p256dh: string;
  auth: string;
}
