import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { SellerOrderService } from './seller-order.service';
import { SellerOrder, PaginatedSellerOrders } from './entities/order.entity';
import { UpdateSellerOrderStatusInput } from './dto/update-seller-order-status.input';

@Resolver(() => SellerOrder)
@UseGuards(JwtAuthGuard)
export class SellerOrderResolver {
  constructor(private readonly sellerOrderService: SellerOrderService) {}

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

  @Query(() => SellerOrder, { name: 'mySellerOrder' })
  mySellerOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.sellerOrderService.mySellerOrder(user.userId, id);
  }

  @Mutation(() => SellerOrder)
  updateSellerOrderStatus(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: UpdateSellerOrderStatusInput,
  ) {
    return this.sellerOrderService.updateStatus(user.userId, input);
  }
}
