/**
 * WebPushChannel — browser Web-Push adapter (VAPID), config-gated (Phase 4).
 *
 * Delivers an encrypted push to one stored `PushSubscription` using the `web-push`
 * library (RFC 8291 payload encryption + VAPID auth — NOT hand-rolled). It is
 * CONFIG-GATED via `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY`: with either unset
 * the channel is a logged no-op, mirroring EmailService's soft-fail contract.
 *
 * The `web-push` package is loaded LAZILY via a runtime specifier + try/catch, so
 * neither the build nor boot fails if the dependency isn't installed yet — the
 * channel simply reports "not installed" and no-ops until `web-push` is added
 * (see the CENTRAL-WIRING report). Once installed + VAPID keys are set, it works
 * with no code change.
 *
 * On a 404/410 from the push service the subscription is dead; we surface
 * `expired:true` so the dispatcher prunes it.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChannelSendResult,
  ISendChannel,
  NOTIFICATION_CHANNEL,
  NotificationChannel,
  OutboundNotification,
  WebPushDestination,
} from './send-channel.interface';

/** How long the push service should retain an undelivered message (seconds). */
const WEB_PUSH_TTL_SECONDS = 12 * 60 * 60; // 12h

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WebPushLib = any;

@Injectable()
export class WebPushChannel implements ISendChannel<WebPushDestination> {
  readonly channel: NotificationChannel = NOTIFICATION_CHANNEL.WEB_PUSH;
  private readonly logger = new Logger(WebPushChannel.name);

  // Cached resolved library: `undefined` = not yet tried, `null` = absent.
  private lib: WebPushLib | null | undefined = undefined;
  private vapidApplied = false;

  constructor(private readonly config: ConfigService) {}

  /** True when both VAPID keys are present. */
  isConfigured(): boolean {
    return Boolean(this.publicKey() && this.privateKey());
  }

  async send(
    destination: WebPushDestination,
    message: OutboundNotification,
  ): Promise<ChannelSendResult> {
    if (!this.isConfigured()) {
      this.logger.warn(
        `Skipped Web-Push "${message.type}" — VAPID keys are not configured.`,
      );
      return { sent: false, skipped: true, message: 'web-push not configured' };
    }

    const webpush = await this.load();
    if (!webpush) {
      this.logger.warn(
        `Skipped Web-Push "${message.type}" — the "web-push" package is not installed.`,
      );
      return { sent: false, skipped: true, message: 'web-push not installed' };
    }

    this.applyVapid(webpush);

    const subscription = {
      endpoint: destination.endpoint,
      keys: { p256dh: destination.p256dh, auth: destination.auth },
    };
    const payload = JSON.stringify({
      title: message.title,
      body: message.body,
      url: message.url ?? null,
      type: message.type,
      data: message.data ?? {},
    });

    try {
      await webpush.sendNotification(subscription, payload, {
        TTL: WEB_PUSH_TTL_SECONDS,
      });
      this.logger.log(`Sent Web-Push "${message.type}".`);
      return { sent: true };
    } catch (err) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      const msg = (err as Error).message;
      // 404 (endpoint unknown) / 410 (subscription gone) ⇒ prune it.
      if (statusCode === 404 || statusCode === 410) {
        return { sent: false, expired: true, message: `gone (${statusCode})` };
      }
      this.logger.error(`Web-Push "${message.type}" failed: ${msg}`);
      return { sent: false, message: msg };
    }
  }

  // ---- internals ------------------------------------------------------------

  /** Apply VAPID details once per resolved library instance. */
  private applyVapid(webpush: WebPushLib): void {
    if (this.vapidApplied) return;
    try {
      webpush.setVapidDetails(this.subject(), this.publicKey()!, this.privateKey()!);
      this.vapidApplied = true;
    } catch (err) {
      // A malformed key/subject only affects this send attempt; log + move on.
      this.logger.error(`Invalid VAPID configuration: ${(err as Error).message}`);
    }
  }

  /**
   * Lazily import `web-push`. A RUNTIME (non-literal) specifier keeps TypeScript
   * from hard-failing the build when the package is absent, and the try/catch
   * turns a missing dependency into a graceful runtime no-op.
   */
  private async load(): Promise<WebPushLib | null> {
    if (this.lib !== undefined) return this.lib;
    try {
      // `: string` widens the specifier off its literal type so TypeScript can't
      // statically resolve it — this is what keeps `nest build` from failing with
      // TS2307 when `web-push` isn't installed. The require then either loads it
      // or throws (→ null no-op).
      const moduleName: string = 'web-push';
      const mod: WebPushLib = await import(moduleName);
      this.lib = (mod && mod.default) || mod;
    } catch {
      this.lib = null;
    }
    return this.lib;
  }

  private publicKey(): string | undefined {
    return this.str('VAPID_PUBLIC_KEY');
  }
  private privateKey(): string | undefined {
    return this.str('VAPID_PRIVATE_KEY');
  }
  /**
   * VAPID subject — a `mailto:` or `https:` URL identifying the sender. Falls
   * back to FRONTEND_URL (an https URL in prod) then a mailto placeholder.
   */
  private subject(): string {
    return (
      this.str('VAPID_SUBJECT') ??
      this.str('FRONTEND_URL') ??
      'mailto:notifications@localhost'
    );
  }
  private str(key: string): string | undefined {
    const v = this.config.get<string>(key);
    return v && String(v).trim() !== '' ? String(v).trim() : undefined;
  }
}
