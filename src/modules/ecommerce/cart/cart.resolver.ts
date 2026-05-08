import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { CartService } from './cart.service';
import { Cart } from './entities/cart.entity';
import { AddToCartInput } from './dto/add-to-cart.input';
import { UpdateCartItemQtyInput } from './dto/update-cart-item-qty.input';
import { RemoveCartItemInput } from './dto/remove-cart-item.input';

/**
 * All cart endpoints are JWT-gated and customer-only — `CartService`
 * looks up the Customer extension and rejects non-customer calls with
 * ForbiddenException.
 */
@Resolver(() => Cart)
@UseGuards(JwtAuthGuard)
export class CartResolver {
  constructor(private readonly cartService: CartService) {}

  @Query(() => Cart, { name: 'myCart' })
  myCart(@CurrentUser() user: CurrentUserPayload) {
    return this.cartService.myCart(user.userId);
  }

  @Query(() => Int, { name: 'myCartItemCount' })
  myCartItemCount(@CurrentUser() user: CurrentUserPayload) {
    return this.cartService.myCartItemCount(user.userId);
  }

  @Mutation(() => Cart)
  addToCart(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: AddToCartInput,
  ) {
    return this.cartService.add(user.userId, input);
  }

  @Mutation(() => Cart)
  updateCartItemQty(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: UpdateCartItemQtyInput,
  ) {
    return this.cartService.updateQty(user.userId, input);
  }

  @Mutation(() => Cart)
  removeFromCart(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: RemoveCartItemInput,
  ) {
    return this.cartService.remove(user.userId, input);
  }

  @Mutation(() => Cart)
  clearCart(@CurrentUser() user: CurrentUserPayload) {
    return this.cartService.clear(user.userId);
  }
}
