/**
 * RefundAdminResolver — admin refund management (the money movers).
 *
 * Gated by PermissionsGuard with the `refund:*` permissions seeded in
 * rolePermission.seed.ts.
 */

import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { RefundStatus } from '@prisma/client';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { RefundService } from './refund.service';
import { RefundEntity, PaginatedRefunds } from './entities/refund.entity';

@Resolver()
export class RefundAdminResolver {
  constructor(private readonly refundService: RefundService) {}

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('refund:read')
  @Query(() => PaginatedRefunds, { name: 'adminRefunds' })
  async listRefunds(
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('pageSize', { type: () => Int, defaultValue: 10 }) pageSize: number,
    @Args('status', { type: () => RefundStatus, nullable: true })
    status?: RefundStatus,
    @Args('orderId', { type: () => ID, nullable: true }) orderId?: string,
  ) {
    return this.refundService.listRefunds({ page, pageSize, status, orderId });
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('refund:approve')
  @Mutation(() => RefundEntity, { name: 'approveRefund' })
  async approveRefund(
    @CurrentUser() user: CurrentUserPayload,
    @Args('refundId', { type: () => ID }) refundId: string,
  ) {
    return this.refundService.approveRefund(user.userId, refundId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('refund:reject')
  @Mutation(() => RefundEntity, { name: 'rejectRefund' })
  async rejectRefund(
    @CurrentUser() user: CurrentUserPayload,
    @Args('refundId', { type: () => ID }) refundId: string,
    @Args('reason', { type: () => String, nullable: true }) reason?: string,
  ) {
    return this.refundService.rejectRefund(user.userId, refundId, reason);
  }
}
