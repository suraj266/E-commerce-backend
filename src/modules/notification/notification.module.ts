/**
 * NotificationModule — the in-app notification bell (P3-08) + Phase 4 channel
 * depth (SMS, Web-Push, back-in-stock alerts).
 *
 * `@Global` (mirroring AuditModule / OutboxCoreModule / PrismaModule) so the
 * outbox worker handlers + the domain services that own the lifecycle-email
 * senders (order / refund / seller / courier) can inject `NotificationService`
 * to write a bell entry ALONGSIDE each email WITHOUT every one of their modules
 * having to add an import — notifications are a cross-cutting side effect.
 * Registered once in AppModule.
 *
 * Phase 4 additions (all provided here so the @Global export stays the single
 * wiring point):
 *   - Channel adapters (SmsChannel / WebPushChannel) + NotificationDispatchService:
 *     NotificationService.create() fans each bell out to SMS + Web-Push. Both
 *     adapters are config-gated and no-op without creds.
 *   - PushSubscription register/unregister contract (PushSubscriptionResolver +
 *     Service) for browser Web-Push registration.
 *   - BackInStockService + BackInStockCron: wishlist restock alerts. The service
 *     is EXPORTED so the central outbox EmailsProcessor can run its
 *     `notification.back_in_stock` handler.
 *
 * EmailModule is imported for the back-in-stock email (EmailService). All other
 * deps (PrismaService, OutboxService, ConfigService) are @Global.
 */

import { Global, Module } from '@nestjs/common';
import { EmailModule } from '@/modules/admin/email/email.module';
import { PrivacyModule } from '@/modules/compliance/privacy/privacy.module';
import { NotificationService } from './notification.service';
import { NotificationResolver } from './notification.resolver';
import { SmsChannel } from './channels/sms.channel';
import { WebPushChannel } from './channels/web-push.channel';
import { NotificationDispatchService } from './channels/notification-dispatch.service';
import { PushSubscriptionService } from './push-subscription.service';
import { PushSubscriptionResolver } from './push-subscription.resolver';
import { BackInStockService } from './back-in-stock.service';
import { BackInStockCron } from './back-in-stock.cron';

@Global()
@Module({
  // PrivacyModule → PrivacyService.canMarket (the authoritative marketing-consent
  // gate) for the SMS fan-out + back-in-stock email (P4 review #1/#6). One-way
  // edge — PrivacyService injects nothing from this module.
  imports: [EmailModule, PrivacyModule],
  providers: [
    NotificationService,
    NotificationResolver,
    // Phase 4 channel fan-out.
    SmsChannel,
    WebPushChannel,
    NotificationDispatchService,
    // Phase 4 Web-Push registration.
    PushSubscriptionService,
    PushSubscriptionResolver,
    // Phase 4 back-in-stock alerts.
    BackInStockService,
    BackInStockCron,
  ],
  exports: [NotificationService, BackInStockService],
})
export class NotificationModule {}
