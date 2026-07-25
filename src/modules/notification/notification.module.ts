/**
 * NotificationModule — the in-app notification bell (P3-08).
 *
 * `@Global` (mirroring AuditModule / OutboxCoreModule / PrismaModule) so the
 * outbox worker handlers + the domain services that own the lifecycle-email
 * senders (order / refund / seller / courier) can inject `NotificationService`
 * to write a bell entry ALONGSIDE each email WITHOUT every one of their modules
 * having to add an import — notifications are a cross-cutting side effect.
 * Registered once in AppModule.
 *
 * Also provides the read/mark resolver (the myNotifications /
 * unreadNotificationCount / markNotificationRead / markAllNotificationsRead
 * contract), each authenticated + scoped to the acting principal.
 */

import { Global, Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationResolver } from './notification.resolver';

@Global()
@Module({
  providers: [NotificationService, NotificationResolver],
  exports: [NotificationService],
})
export class NotificationModule {}
