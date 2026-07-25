/**
 * OrderAdminResolver — cross-seller admin order console (Phase 3 Wave 4).
 *
 * Separate from OrderResolver (customer) and SellerOrderResolver (seller +
 * invoice-audit admin surface). Reads gate on `order:read`; the guarded cancel
 * gates on `order:manage`. Both slugs are NEW — REPORTED to the orchestrator for
 * rolePermission.seed.ts + the superAdmin grant.
 */

import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { OrderAdminService } from './order-admin.service';
import { Order, PaginatedOrders } from './entities/order.entity';

@Resolver(() => Order)
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrderAdminResolver {
  constructor(private readonly orderAdmin: OrderAdminService) {}

  /** Cross-seller admin order list with status/payment/seller/date-range/search filters. Auth: order:read permission. */
  @Query(() => PaginatedOrders, { name: 'adminOrders' })
  @Permissions('order:read')
  adminOrders(
    @Args('status', { type: () => OrderStatus, nullable: true })
    status?: OrderStatus,
    @Args('paymentStatus', { type: () => PaymentStatus, nullable: true })
    paymentStatus?: PaymentStatus,
    @Args('sellerId', { type: () => ID, nullable: true }) sellerId?: string,
    @Args('search', { type: () => String, nullable: true }) search?: string,
    @Args('dateFrom', { type: () => Date, nullable: true }) dateFrom?: Date,
    @Args('dateTo', { type: () => Date, nullable: true }) dateTo?: Date,
    @Args('page', { type: () => Int, nullable: true }) page?: number,
    @Args('pageSize', { type: () => Int, nullable: true }) pageSize?: number,
  ) {
    return this.orderAdmin.adminOrders({
      status,
      paymentStatus,
      sellerId,
      search,
      dateFrom,
      dateTo,
      page,
      pageSize,
    });
  }

  /** Cross-seller admin order detail by id (no ownership check). Auth: order:read permission. */
  @Query(() => Order, { name: 'adminOrder' })
  @Permissions('order:read')
  adminOrder(@Args('id', { type: () => ID }) id: string) {
    return this.orderAdmin.adminOrder(id);
  }

  /** Admin cancels a not-yet-paid, pre-fulfilment order (releases stock); paid/shipped orders are refused → use Refunds console. Auth: order:manage permission. */
  @Mutation(() => Order, { name: 'adminCancelOrder' })
  @Permissions('order:manage')
  adminCancelOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('reason', { type: () => String, nullable: true }) reason?: string,
  ) {
    return this.orderAdmin.adminCancelOrder(user.userId, id, reason);
  }
}
