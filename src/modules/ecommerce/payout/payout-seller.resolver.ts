/**
 * PayoutSellerResolver — a seller's read-only view of their own payout runs.
 *
 * The admin resolver (payout-admin.resolver.ts) is `payout:read` gated and can
 * list any seller's runs. This one is JwtAuthGuard-only and NEVER accepts a
 * sellerId argument: PayoutService.myPayouts resolves the caller's own sellerId
 * from the authenticated userId and scopes the list to it, so seller A can
 * never read seller B's payouts. No money logic — history list only.
 */

import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { PayoutStatus } from '@prisma/client';

import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { PayoutService } from './payout.service';
import { PaginatedPayouts } from './entities/payout.entity';

@Resolver()
export class PayoutSellerResolver {
  constructor(private readonly payoutService: PayoutService) {}

  /** Paginated history of the caller's OWN payout runs, filterable by status. Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Query(() => PaginatedPayouts, { name: 'myPayouts' })
  async myPayouts(
    @CurrentUser() user: CurrentUserPayload,
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('pageSize', { type: () => Int, defaultValue: 10 }) pageSize: number,
    @Args('status', { type: () => PayoutStatus, nullable: true })
    status?: PayoutStatus,
  ) {
    return this.payoutService.myPayouts(user.userId, { page, pageSize, status });
  }
}
