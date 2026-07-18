/**
 * RefundResolver — customer-facing refund requests.
 *
 * A customer requests a refund on their own order (or one seller slice). No
 * money moves — the request lands as REQUESTED for an admin to approve.
 */

import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { RefundService } from './refund.service';
import { RefundEntity } from './entities/refund.entity';
import { RequestRefundInput } from './dto/request-refund.input';

@Resolver()
export class RefundResolver {
  constructor(private readonly refundService: RefundService) {}

  @Mutation(() => RefundEntity, { name: 'requestRefund' })
  @UseGuards(JwtAuthGuard)
  async requestRefund(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: RequestRefundInput,
  ) {
    return this.refundService.requestRefund(user.userId, input);
  }

  @Query(() => [RefundEntity], { name: 'myRefunds' })
  @UseGuards(JwtAuthGuard)
  async myRefunds(@CurrentUser() user: CurrentUserPayload) {
    return this.refundService.myRefunds(user.userId);
  }
}
