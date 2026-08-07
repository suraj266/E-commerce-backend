/**
 * PushSubscriptionResolver — customer-scoped Web-Push registration contract
 * (Phase 4, notification depth).
 *
 * `webPushPublicKey` is public (the VAPID APPLICATION SERVER key is meant to be
 * shipped to browsers so they can `PushManager.subscribe`); it returns null when
 * Web-Push isn't configured so the client can hide the "enable notifications"
 * affordance. Everything else is authenticated (JwtAuthGuard) and scoped to the
 * acting principal — no permission slug (this is customer self-service, like the
 * notification-bell contract).
 */

import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { PushSubscriptionService } from './push-subscription.service';
import { PushSubscriptionEntity } from './entities/push-subscription.entity';
import { RegisterPushSubscriptionInput } from './dto/register-push-subscription.input';

@Resolver(() => PushSubscriptionEntity)
export class PushSubscriptionResolver {
  constructor(
    private readonly pushSubscriptions: PushSubscriptionService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The VAPID public (application server) key the browser needs to subscribe,
   * or null when Web-Push is not configured. Public — safe to expose.
   */
  @Query(() => String, { name: 'webPushPublicKey', nullable: true })
  webPushPublicKey(): string | null {
    const key = this.config.get<string>('VAPID_PUBLIC_KEY');
    return key && key.trim() !== '' ? key.trim() : null;
  }

  /** The caller's registered push devices. Auth: logged-in user. */
  @UseGuards(JwtAuthGuard)
  @Query(() => [PushSubscriptionEntity], { name: 'myPushSubscriptions' })
  myPushSubscriptions(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<PushSubscriptionEntity[]> {
    return this.pushSubscriptions.listForUser(user.userId);
  }

  /** Register (or refresh) a browser push subscription. Auth: logged-in user. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => PushSubscriptionEntity, { name: 'registerPushSubscription' })
  registerPushSubscription(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: RegisterPushSubscriptionInput,
  ): Promise<PushSubscriptionEntity> {
    return this.pushSubscriptions.register(user.userId, input);
  }

  /**
   * Remove one of the caller's push subscriptions by endpoint (on logout / when
   * the browser reports it unsubscribed). Returns true if a row was removed.
   * Auth: logged-in user.
   */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => Boolean, { name: 'unregisterPushSubscription' })
  unregisterPushSubscription(
    @CurrentUser() user: CurrentUserPayload,
    @Args('endpoint') endpoint: string,
  ): Promise<boolean> {
    return this.pushSubscriptions.unregister(user.userId, endpoint);
  }
}
