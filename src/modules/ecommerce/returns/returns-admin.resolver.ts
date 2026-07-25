/**
 * ReturnsAdminResolver — cross-seller returns oversight.
 *
 * Gated by PermissionsGuard. Reuses the existing `refund:read` slug (returns are
 * the refund-adjacent surface). // CENTRAL-WIRING: a dedicated `return:read` /
 * `return:manage` slug is preferred — see the report; seed it in
 * rolePermission.seed.ts and swap the @Permissions below.
 */

import { Args, ID, Int, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ReturnStatus } from '@prisma/client';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import { ReturnsService } from './returns.service';
import {
  ReturnRequestEntity,
  PaginatedReturns,
} from './entities/return.entity';

@Resolver()
export class ReturnsAdminResolver {
  constructor(private readonly returns: ReturnsService) {}

  /** Cross-seller returns list, filterable by status/seller. Auth: return:read permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('return:read')
  @Query(() => PaginatedReturns, { name: 'adminReturns' })
  async adminReturns(
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('pageSize', { type: () => Int, defaultValue: 10 }) pageSize: number,
    @Args('status', { type: () => ReturnStatus, nullable: true })
    status?: ReturnStatus,
    @Args('sellerId', { type: () => ID, nullable: true }) sellerId?: string,
  ) {
    return this.returns.listReturns({ page, pageSize, status, sellerId });
  }

  /** Any return's detail plus linked manual-refund info for finance disbursement. Auth: return:read permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('return:read')
  @Query(() => ReturnRequestEntity, { name: 'adminReturn' })
  async adminReturn(@Args('id', { type: () => ID }) id: string) {
    return this.returns.adminReturnDetail(id);
  }
}
