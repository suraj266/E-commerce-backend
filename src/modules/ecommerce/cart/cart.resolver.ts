import { Args, Context, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
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
import { GUEST_CART_COOKIE } from './guest-cart.resolver';

/**
 * All cart endpoints are JWT-gated and customer-only — `CartService`
 * looks up the Customer extension and rejects non-customer calls with
 * ForbiddenException.
 */
@Resolver(() => Cart)
@UseGuards(JwtAuthGuard)
export class CartResolver {
  constructor(private readonly cartService: CartService) {}

  /** Returns the signed-in customer's hydrated cart with live stock/price. Auth: logged-in customer. */
  @Query(() => Cart, { name: 'myCart' })
  myCart(@CurrentUser() user: CurrentUserPayload) {
    return this.cartService.myCart(user.userId);
  }

  /** Total item-quantity for the header badge (skips product hydration). Auth: logged-in customer. */
  @Query(() => Int, { name: 'myCartItemCount' })
  myCartItemCount(@CurrentUser() user: CurrentUserPayload) {
    return this.cartService.myCartItemCount(user.userId);
  }

  /** Adds a variant to the cart, merging into any existing line (capped at 99/line). Auth: logged-in customer. */
  @Mutation(() => Cart)
  addToCart(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: AddToCartInput,
  ) {
    return this.cartService.add(user.userId, input);
  }

  /** Sets a cart line's quantity; quantity 0 removes the line. Auth: logged-in customer. */
  @Mutation(() => Cart)
  updateCartItemQty(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: UpdateCartItemQtyInput,
  ) {
    return this.cartService.updateQty(user.userId, input);
  }

  /** Removes a variant line from the customer's cart. Auth: logged-in customer. */
  @Mutation(() => Cart)
  removeFromCart(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: RemoveCartItemInput,
  ) {
    return this.cartService.remove(user.userId, input);
  }

  /** Empties every item from the customer's cart (keeps the cart row). Auth: logged-in customer. */
  @Mutation(() => Cart)
  clearCart(@CurrentUser() user: CurrentUserPayload) {
    return this.cartService.clear(user.userId);
  }

  /**
   * Explicitly fold the guest cart (guestCartToken cookie) into the signed-in
   * customer's cart, then clear the cookie. Login already does this best-effort
   * server-side; this mutation exists for flows that authenticate without the
   * REST login path (e.g. token already present). Returns the merged customer
   * cart.
   */
  @Mutation(() => Cart)
  async mergeGuestCart(
    @CurrentUser() user: CurrentUserPayload,
    @Context() ctx: { req: Request & { cookies?: Record<string, string> }; res: Response },
  ) {
    const token = ctx.req?.cookies?.[GUEST_CART_COOKIE];
    const cart = await this.cartService.mergeGuestIntoCustomer(
      user.userId,
      token,
    );
    if (token) {
      ctx.res?.clearCookie(GUEST_CART_COOKIE, {
        path: '/',
        domain:
          process.env.NODE_ENV === 'production'
            ? process.env.COOKIE_DOMAIN
            : undefined,
      });
    }
    return cart;
  }
}
