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

  @Query(() => Order, { name: 'myOrder' })
  myOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.orderService.myOrder(user.userId, id);
  }

  @Mutation(() => Order)
  placeOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: PlaceOrderInput,
  ) {
    return this.orderService.placeOrder(user.userId, input);
  }

  @Mutation(() => Order)
  cancelMyOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('notes', { type: () => String, nullable: true }) notes?: string,
  ) {
    return this.orderService.cancelMyOrder(user.userId, id, notes);
  }
}
