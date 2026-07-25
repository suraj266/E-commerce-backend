import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CourierProvider } from '@prisma/client';
import { CourierAccountService } from './courier-account.service';
import { CourierService } from './courier.service';
import { CourierAccountSafe } from './entities/courier-account.entity';
import {
  CourierOptionsResult,
  CourierPickupLocation,
} from './entities/courier-extra.entity';
import { ConnectCourierAccountInput } from './dto/connect-courier-account.input';
import { SellerOrder } from '@/modules/ecommerce/order/entities/order.entity';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';

@Resolver(() => CourierAccountSafe)
@UseGuards(JwtAuthGuard)
export class CourierResolver {
  constructor(
    private readonly accounts: CourierAccountService,
    private readonly courier: CourierService,
    private readonly config: ConfigService,
  ) {}

  // --- Account config ---

  /** The seller's connected courier accounts (masked — no credentials/token). Auth: logged-in seller. */
  @Query(() => [CourierAccountSafe], { name: 'myCourierAccounts' })
  async myCourierAccounts(@CurrentUser() user: CurrentUserPayload) {
    const list = await this.accounts.myAccounts(user.userId);
    return list.map((a) => this.accounts.toSafeShape(a));
  }

  /** The webhook URL the seller pastes into their courier panel (x-api-key auth). */
  @Query(() => String, { name: 'courierWebhookUrl' })
  courierWebhookUrl(): string {
    const base = (this.config.get<string>('PUBLIC_API_URL') ?? '').replace(/\/+$/, '');
    return `${base}/webhooks/courier`;
  }

  /** Connect a courier provider account; validates + mints a token immediately, only enabling on success. Auth: logged-in seller. */
  @Mutation(() => CourierAccountSafe)
  async connectCourierAccount(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: ConnectCourierAccountInput,
  ) {
    const a = await this.accounts.connect(user.userId, input);
    return this.accounts.toSafeShape(a);
  }

  /** Re-test a connected provider's stored credentials, refreshing its auth token. Auth: logged-in seller. */
  @Mutation(() => CourierAccountSafe)
  async testCourierConnection(
    @CurrentUser() user: CurrentUserPayload,
    @Args('provider', { type: () => CourierProvider }) provider: CourierProvider,
  ) {
    const a = await this.accounts.test(user.userId, provider);
    return this.accounts.toSafeShape(a);
  }

  /** Enable/disable a provider account (the enabled one drives live rates + fulfillment). Auth: logged-in seller. */
  @Mutation(() => CourierAccountSafe)
  async setCourierAccountEnabled(
    @CurrentUser() user: CurrentUserPayload,
    @Args('provider', { type: () => CourierProvider }) provider: CourierProvider,
    @Args('enabled') enabled: boolean,
  ) {
    const a = await this.accounts.setEnabled(user.userId, provider, enabled);
    return this.accounts.toSafeShape(a);
  }

  // --- Pickup locations (fetch from provider, seller selects one) ---

  /** Fetch the provider's existing pickup locations so the seller can pick one. Auth: logged-in seller. */
  @Query(() => [CourierPickupLocation], { name: 'courierPickupLocations' })
  courierPickupLocations(
    @CurrentUser() user: CurrentUserPayload,
    @Args('provider', { type: () => CourierProvider }) provider: CourierProvider,
  ) {
    return this.courier.listPickupLocations(user.userId, provider);
  }

  /** Store the webhook token the seller pasted from their courier panel (used to verify inbound tracking). Auth: logged-in seller. */
  @Mutation(() => CourierAccountSafe)
  async setCourierWebhookToken(
    @CurrentUser() user: CurrentUserPayload,
    @Args('provider', { type: () => CourierProvider }) provider: CourierProvider,
    @Args('token') token: string,
  ) {
    const a = await this.accounts.setWebhookSecret(user.userId, provider, token);
    return this.accounts.toSafeShape(a);
  }

  /** Select which existing provider pickup location the seller's orders ship from. Auth: logged-in seller. */
  @Mutation(() => CourierAccountSafe)
  async setCourierPickupLocation(
    @CurrentUser() user: CurrentUserPayload,
    @Args('provider', { type: () => CourierProvider }) provider: CourierProvider,
    @Args('nickname') nickname: string,
  ) {
    const a = await this.accounts.setPickupLocation(user.userId, provider, nickname);
    return this.accounts.toSafeShape(a);
  }

  // --- Fulfillment ---

  /** Available couriers (live serviceability) for the ship-time picker. */
  @Query(() => CourierOptionsResult, { name: 'courierOptionsForOrder' })
  async courierOptionsForOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Args('sellerOrderId', { type: () => ID }) sellerOrderId: string,
  ): Promise<CourierOptionsResult> {
    const res = await this.courier.getCourierOptions(user.userId, sellerOrderId);
    return {
      couriers: res.couriers
        .filter((c) => c.serviceable)
        .map((c) => ({
          courierId: c.providerCourierId,
          courierName: c.courierName,
          rate: c.rate,
          estimatedDays: c.estimatedDays,
          codAvailable: c.codAvailable,
          recommended: c.recommended,
        })),
      selectedCourierId: res.selectedCourierId,
      selectedCourierName: res.selectedCourierName,
    };
  }

  /** Assign the chosen courier → AWB → label → mark SHIPPED. */
  @Mutation(() => SellerOrder)
  shipViaCourier(
    @CurrentUser() user: CurrentUserPayload,
    @Args('sellerOrderId', { type: () => ID }) sellerOrderId: string,
    @Args('courierId', { type: () => String }) courierId: string,
  ) {
    return this.courier.shipViaCourier(user.userId, sellerOrderId, courierId);
  }
}
