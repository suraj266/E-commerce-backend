/**
 * NotificationResolver — the P3-08 in-app notification bell contract.
 *
 * Every operation is authenticated (JwtAuthGuard) and scoped to the acting
 * principal via @CurrentUser — a user can only read/mark their OWN
 * notifications. There is intentionally NO create mutation: notifications are
 * written only by NotificationService.create() from the outbox worker handlers.
 */

import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { NotFoundException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { NotificationService } from './notification.service';
import { NotificationEntity } from './entities/notification.entity';

@Resolver(() => NotificationEntity)
export class NotificationResolver {
  constructor(private readonly notifications: NotificationService) {}

  /** Lists the caller's own notifications, newest first (paginated). Auth: logged-in user. */
  @UseGuards(JwtAuthGuard)
  @Query(() => [NotificationEntity], { name: 'myNotifications' })
  myNotifications(
    @CurrentUser() user: CurrentUserPayload,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 20 })
    limit: number,
    @Args('offset', { type: () => Int, nullable: true, defaultValue: 0 })
    offset: number,
  ): Promise<NotificationEntity[]> {
    return this.notifications.listForUser(user.userId, limit, offset);
  }

  /** Count of the caller's unread notifications (bell badge). Auth: logged-in user. */
  @UseGuards(JwtAuthGuard)
  @Query(() => Int, { name: 'unreadNotificationCount' })
  unreadNotificationCount(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<number> {
    return this.notifications.unreadCount(user.userId);
  }

  /** Marks one of the caller's notifications read; 404s if the id isn't theirs. Auth: logged-in user. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => NotificationEntity, { name: 'markNotificationRead' })
  async markNotificationRead(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<NotificationEntity> {
    const updated = await this.notifications.markRead(user.userId, id);
    if (!updated) throw new NotFoundException('Notification not found');
    return updated;
  }

  /** Marks all the caller's notifications read; returns how many changed. Auth: logged-in user. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => Int, { name: 'markAllNotificationsRead' })
  markAllNotificationsRead(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<number> {
    return this.notifications.markAllRead(user.userId);
  }
}
