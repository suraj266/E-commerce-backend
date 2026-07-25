/**
 * PayoutAdminResolver — admin-only seller settlement management.
 *
 * Gated by PermissionsGuard with the `payout:*` run permissions seeded in
 * rolePermission.seed.ts (distinct from the payout-ACCOUNT CRUD permissions).
 */

import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { PayoutStatus } from '@prisma/client';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { PayoutService } from './payout.service';
import {
  PayoutEntity,
  PayoutPreview,
  PaginatedPayouts,
} from './entities/payout.entity';
import { MarkPayoutPaidInput } from './dto/mark-payout-paid.input';

@Resolver()
export class PayoutAdminResolver {
  constructor(private readonly payoutService: PayoutService) {}

  /** Dry-run per-seller settlement preview, netting refunds, §52 TCS and return clawbacks; persists nothing. Auth: payout:preview permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('payout:preview')
  @Query(() => [PayoutPreview], { name: 'payoutPreview' })
  async payoutPreview(
    @Args('sellerId', { type: () => ID, nullable: true }) sellerId?: string,
  ) {
    return this.payoutService.previewPayoutRun(sellerId);
  }

  /** Paginated list of payout runs, filterable by status/seller. Auth: payout:read permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('payout:read')
  @Query(() => PaginatedPayouts, { name: 'adminPayouts' })
  async listPayouts(
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('pageSize', { type: () => Int, defaultValue: 10 }) pageSize: number,
    @Args('status', { type: () => PayoutStatus, nullable: true })
    status?: PayoutStatus,
    @Args('sellerId', { type: () => ID, nullable: true }) sellerId?: string,
  ) {
    return this.payoutService.listPayouts({ page, pageSize, status, sellerId });
  }

  /** Materializes payout runs (PROCESSING) per seller and flips included seller orders to PROCESSING; settles each order at most once. Auth: payout:run permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('payout:run')
  @Mutation(() => [PayoutEntity], { name: 'createPayoutRun' })
  async createPayoutRun(
    @CurrentUser() user: CurrentUserPayload,
    @Args('sellerId', { type: () => ID, nullable: true }) sellerId?: string,
  ) {
    return this.payoutService.createPayoutRun(user.userId, sellerId);
  }

  /** Records the manual bank/UPI transfer (UTR) marking a PROCESSING payout PAID; idempotent, emails the seller. Auth: payout:disburse permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('payout:disburse')
  @Mutation(() => PayoutEntity, { name: 'markPayoutPaid' })
  async markPayoutPaid(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: MarkPayoutPaidInput,
  ) {
    return this.payoutService.markPayoutPaid(user.userId, input);
  }

  /** Marks a PROCESSING payout FAILED: reverts its seller orders to PENDING and drops items so a fresh run can retry. Auth: payout:disburse permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('payout:disburse')
  @Mutation(() => PayoutEntity, { name: 'markPayoutFailed' })
  async markPayoutFailed(
    @Args('payoutId', { type: () => ID }) payoutId: string,
    @Args('reason', { type: () => String }) reason: string,
  ) {
    return this.payoutService.markPayoutFailed(payoutId, reason);
  }
}
