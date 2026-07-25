import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { OrderService } from './order.service';
import { Order, PaginatedOrders } from './entities/order.entity';
import { PlaceOrderInput } from './dto/place-order.input';

/**
 * Customer-facing order operations. Sellers and admins use separate
 * resolvers so we never accidentally surface a seller's view to a
 * customer (or vice versa).
 */
@Resolver(() => Order)
@UseGuards(JwtAuthGuard)
export class OrderResolver {
  constructor(private readonly orderService: OrderService) {}

  /** Paginated list of the customer's own orders, optional status filter. Auth: logged-in customer. */
  @Query(() => PaginatedOrders, { name: 'myOrders' })
  myOrders(
    @CurrentUser() user: CurrentUserPayload,
    @Args('status', { type: () => OrderStatus, nullable: true })
    status?: OrderStatus,
    @Args('page', { type: () => Int, nullable: true }) page?: number,
    @Args('pageSize', { type: () => Int, nullable: true }) pageSize?: number,
  ) {
    return this.orderService.myOrders(user.userId, { status, page, pageSize });
  }

  /** Customer order detail by id (ownership-checked). Auth: logged-in customer. */
  @Query(() => Order, { name: 'myOrder' })
  myOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.orderService.myOrder(user.userId, id);
  }

  /** Places an order from the cart in one transaction; reserves stock across warehouses and empties the cart. Auth: logged-in customer. */
  @Mutation(() => Order)
  placeOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: PlaceOrderInput,
  ) {
    return this.orderService.placeOrder(user.userId, input);
  }

  /** Customer cancels their own order; only while all sub-orders are still PENDING, releases reserved stock. Auth: logged-in customer. */
  @Mutation(() => Order)
  cancelMyOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('notes', { type: () => String, nullable: true }) notes?: string,
  ) {
    return this.orderService.cancelMyOrder(user.userId, id, notes);
  }
}
