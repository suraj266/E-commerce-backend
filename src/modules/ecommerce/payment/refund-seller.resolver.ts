/**
 * RefundSellerResolver — seller-facing refunds on their own cancelled orders.
 *
 * Audience-split from RefundResolver (customer) and RefundAdminResolver (finance)
 * for the same reason the order resolvers are split: a seller must never be able
 * to reach another seller's slice, and the guards that enforce that live in the
 * service, keyed off the caller's Seller record.
 *
 * No PermissionsGuard here — this mirrors SellerOrderResolver: authentication is
 * the gate, ownership is enforced in the service (a seller has no admin
 * `refund:*` permission, so an RBAC check would reject every legitimate caller).
 */

import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { RefundService } from './refund.service';
import { RefundEntity } from './entities/refund.entity';
import { SellerRefundPreview } from './entities/seller-refund-preview.entity';
import { CreateSellerRefundInput } from './dto/create-seller-refund.input';

@Resolver()
@UseGuards(JwtAuthGuard)
export class RefundSellerResolver {
  constructor(private readonly refundService: RefundService) {}

  /** Money breakdown + refundable ceiling for the seller's own sub-order; resolves with a blockedReason instead of throwing when a refund isn't possible. Auth: logged-in seller (ownership enforced in service). */
  @Query(() => SellerRefundPreview, { name: 'mySellerOrderRefundPreview' })
  mySellerOrderRefundPreview(
    @CurrentUser() user: CurrentUserPayload,
    @Args('sellerOrderId', { type: () => ID }) sellerOrderId: string,
  ) {
    return this.refundService.getSellerRefundPreview(
      user.userId,
      sellerOrderId,
    );
  }

  /** Seller refunds the buyer for their own CANCELLED sub-order — executes the gateway refund immediately, capped at the seller's own slice. Auth: logged-in seller (ownership enforced in service). */
  @Mutation(() => RefundEntity, { name: 'createSellerRefund' })
  createSellerRefund(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: CreateSellerRefundInput,
  ) {
    return this.refundService.createSellerRefund(user.userId, input);
  }
}
