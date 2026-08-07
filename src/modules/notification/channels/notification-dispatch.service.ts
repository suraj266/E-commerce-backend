/**
 * NotificationDispatchService — the small "fan an in-app notification out to the
 * extra channels" helper (Phase 4, notification depth).
 *
 * NotificationService.create() calls `fanOut()` AFTER it writes the in-app bell,
 * but ONLY when (a) the write happened outside a DB transaction and (b) the bell
 * row was newly inserted (see NotificationService for why). This service then:
 *
 *   1. short-circuits with ZERO DB work when neither SMS nor Web-Push is
 *      configured (the default until creds are added — keeps the hot path free);
 *   2. resolves the recipient's phone + push subscriptions + marketing consent;
 *   3. sends transactional kinds over SMS unconditionally, and marketing-class
 *      kinds only with consent + outside quiet hours (India DLT/TRAI);
 *   4. pushes to every live browser subscription (a subscription IS consent),
 *      pruning any the push service reports as gone.
 *
 * Best-effort throughout: `fanOut` never throws — a channel/provider problem must
 * not fail (and thereby retry) the lifecycle handler that owns the email.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { PrivacyService } from '@/modules/compliance/privacy/privacy.service';
import { isMarketingNotificationType } from '../notification.constants';
import { SmsChannel } from './sms.channel';
import { WebPushChannel } from './web-push.channel';
import { OutboundNotification } from './send-channel.interface';

/**
 * The subset of a notification the fan-out needs. Declared locally (rather than
 * importing NotificationService.CreateNotificationInput) so this file never
 * imports back into notification.service — keeping the module graph acyclic.
 * CreateNotificationInput is structurally assignable to this.
 */
export interface FanOutInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: unknown;
}

/** Quiet-hours window (India promotional SMS restriction), local IST. */
const QUIET_HOURS_START = 21; // 21:00 IST
const QUIET_HOURS_END = 9; // 09:00 IST
const IST_OFFSET_MINUTES = 5 * 60 + 30;

@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsChannel,
    private readonly webPush: WebPushChannel,
    // Authoritative marketing-consent gate (the ConsentRecord ledger). Optional-
    // trailing so the unit spec constructs positionally; the app injects it
    // (NotificationModule imports PrivacyModule). See review #1.
    private readonly privacy?: PrivacyService,
  ) {}

  /**
   * Fan one already-persisted in-app notification out to SMS + Web-Push.
   * Never throws.
   */
  async fanOut(input: FanOutInput, now: Date = new Date()): Promise<void> {
    try {
      const smsOn = this.sms.isConfigured();
      const pushOn = this.webPush.isConfigured();
      if (!smsOn && !pushOn) return; // nothing to do — skip all DB work

      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { phone: true },
      });
      if (!user) return;

      const message = toOutbound(input);

      // Web-Push: a subscription is an explicit per-device opt-in ⇒ no consent
      // gate. Independent of SMS so one channel failing doesn't skip the other.
      if (pushOn) {
        await this.fanPush(input.userId, message);
      }

      // SMS: transactional kinds always; marketing-class only with AUTHORITATIVE
      // consent (PrivacyService.canMarket — the fail-closed ConsentRecord ledger,
      // NOT the deprecated Customer.marketingOptIn flag) + outside the India-DLT
      // quiet-hours window (review #1).
      if (smsOn && user.phone) {
        const marketing = isMarketingNotificationType(input.type);
        let allowed = !marketing;
        if (marketing) {
          const canMarket = this.privacy
            ? await this.privacy.canMarket(input.userId)
            : false; // fail-closed if the consent gate isn't wired
          allowed = canMarket && !inQuietHours(now);
        }
        if (allowed) {
          await this.sms.send(user.phone, message);
        }
      }
    } catch (err) {
      this.logger.warn(
        `Notification fan-out failed for user ${input.userId}: ${(err as Error).message}`,
      );
    }
  }

  /** Push to every live subscription; prune the ones reported gone. */
  private async fanPush(
    userId: string,
    message: OutboundNotification,
  ): Promise<void> {
    const subs = await this.prisma.pushSubscription.findMany({
      where: { userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    if (subs.length === 0) return;

    const expiredIds: string[] = [];
    for (const s of subs) {
      const res = await this.webPush.send(
        { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
        message,
      );
      if (res.expired) expiredIds.push(s.id);
    }

    if (expiredIds.length > 0) {
      try {
        await this.prisma.pushSubscription.deleteMany({
          where: { id: { in: expiredIds } },
        });
      } catch (err) {
        this.logger.warn(
          `Failed pruning ${expiredIds.length} dead push subscription(s): ${(err as Error).message}`,
        );
      }
    }
  }
}

/** Build the channel-agnostic message from a bell notification input. */
function toOutbound(input: FanOutInput): OutboundNotification {
  return {
    type: input.type,
    title: input.title,
    body: input.body,
    url: extractLink(input.data),
    data: toRecord(input.data),
  };
}

/** Notifications carry a `data.link` deep-link target; surface it as the push URL. */
function extractLink(data: unknown): string | undefined {
  const rec = toRecord(data);
  const link = rec?.link;
  return typeof link === 'string' ? link : undefined;
}

function toRecord(data: unknown): Record<string, unknown> | undefined {
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : undefined;
}

/** True when `now` is inside the 21:00–09:00 IST quiet-hours window. */
export function inQuietHours(now: Date): boolean {
  const istMinutes =
    (now.getUTCHours() * 60 + now.getUTCMinutes() + IST_OFFSET_MINUTES) % (24 * 60);
  const hour = Math.floor(istMinutes / 60);
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
}
