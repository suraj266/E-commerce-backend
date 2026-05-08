/**
 * PaymentResolver — customer-facing GraphQL for checkout.
 */

import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { PaymentService } from './payment.service';
import { PaymentConfigService } from './payment-config.service';
import {
  CheckoutResult,
  PaymentGatewayConfigEntity,
} from './entities/payment.entity';
import { InitiateCheckoutInput } from './dto/initiate-checkout.input';
import { VerifyPaymentInput } from './dto/verify-payment.input';
import { Order } from '../order/entities/order.entity';

@Resolver()
export class PaymentResolver {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly configService: PaymentConfigService,
  ) {}

  /**
   * Returns enabled payment gateways for the checkout page.
   * No credentials — just displayName, gateway type, supported methods.
   */
  @Query(() => [PaymentGatewayConfigEntity], { name: 'activePaymentGateways' })
  async activeGateways() {
    return this.configService.getActiveGateways();
  }

  /**
   * Phase 1: Initiate checkout — creates order + payment session.
   */
  @Mutation(() => CheckoutResult, { name: 'initiateCheckout' })
  @UseGuards(JwtAuthGuard)
  async initiateCheckout(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: InitiateCheckoutInput,
  ) {
    return this.paymentService.initiateCheckout(user.userId, input);
  }

  /**
   * Phase 2: Verify payment — frontend confirms after gateway SDK success.
   */
  @Mutation(() => Order, { name: 'verifyPayment' })
  @UseGuards(JwtAuthGuard)
  async verifyPayment(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: VerifyPaymentInput,
  ) {
    return this.paymentService.verifyPayment(user.userId, input);
  }
}
