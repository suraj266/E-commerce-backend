import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { SellerOrderService } from './seller-order.service';
import { SellerOrder, PaginatedSellerOrders } from './entities/order.entity';
import { SellerStats } from './entities/seller-stats.entity';
import { UpdateSellerOrderStatusInput } from './dto/update-seller-order-status.input';

@Resolver(() => SellerOrder)
@UseGuards(JwtAuthGuard)
export class SellerOrderResolver {
  constructor(private readonly sellerOrderService: SellerOrderService) {}

  // ---------------------------------------------------------------------------
  // Admin queries (RBAC-gated). Used by the /admin/invoices surface for
  // tax-invoice auditing and regeneration.
  // ---------------------------------------------------------------------------

  /** Admin fetches any seller-order by id (any seller) for tax-invoice auditing. Auth: invoice:manage permission. */
  @Query(() => SellerOrder, { name: 'adminSellerOrder' })
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('invoice:manage')
  adminSellerOrder(@Args('id', { type: () => ID }) id: string) {
    return this.sellerOrderService.adminSellerOrder(id);
  }

  /** Admin paginated seller-orders, optionally only PAID ones still missing an invoice. Auth: invoice:manage permission. */
  @Query(() => PaginatedSellerOrders, { name: 'adminSellerOrdersWithInvoices' })
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('invoice:manage')
  adminSellerOrdersWithInvoices(
    @Args('page', { type: () => Int, nullable: true }) page?: number,
    @Args('pageSize', { type: () => Int, nullable: true }) pageSize?: number,
    @Args('onlyMissingInvoice', { type: () => Boolean, nullable: true })
    onlyMissingInvoice?: boolean,
  ) {
    return this.sellerOrderService.adminSellerOrdersWithInvoices({
      page,
      pageSize,
      onlyMissingInvoice,
    });
  }

  /** Paginated list of the seller's own sub-orders, optional status filter. Auth: logged-in seller (enforced in service). */
  @Query(() => PaginatedSellerOrders, { name: 'mySellerOrders' })
  mySellerOrders(
    @CurrentUser() user: CurrentUserPayload,
    @Args('status', { type: () => OrderStatus, nullable: true })
    status?: OrderStatus,
    @Args('page', { type: () => Int, nullable: true }) page?: number,
    @Args('pageSize', { type: () => Int, nullable: true }) pageSize?: number,
  ) {
    return this.sellerOrderService.mySellerOrders(user.userId, {
      status,
      page,
      pageSize,
    });
  }

  /** Seller sub-order detail by id (ownership-checked). Auth: logged-in seller (enforced in service). */
  @Query(() => SellerOrder, { name: 'mySellerOrder' })
  mySellerOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.sellerOrderService.mySellerOrder(user.userId, id);
  }

  /** Seller dashboard analytics: net/gross earnings, commission, payouts, order pipeline, 12-month series, best-sellers. Auth: logged-in seller (enforced in service). */
  @Query(() => SellerStats, { name: 'mySellerStats' })
  mySellerStats(@CurrentUser() user: CurrentUserPayload) {
    return this.sellerOrderService.getMyStats(user.userId);
  }

  /** Advances a sub-order through its status workflow; SHIPPED requires a tracking number, COD PENDING→CONFIRMED accrues TCS + generates the invoice. Auth: logged-in seller (enforced in service). */
  @Mutation(() => SellerOrder)
  updateSellerOrderStatus(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: UpdateSellerOrderStatusInput,
  ) {
    return this.sellerOrderService.updateStatus(user.userId, input);
  }
}
