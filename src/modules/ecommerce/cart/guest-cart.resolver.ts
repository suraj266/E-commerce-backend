import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CartService } from './cart.service';
import { Cart } from './entities/cart.entity';
import { CartValidationResult } from './entities/cart-validation.entity';
import { AddToCartInput } from './dto/add-to-cart.input';
import { UpdateCartItemQtyInput } from './dto/update-cart-item-qty.input';
import { RemoveCartItemInput } from './dto/remove-cart-item.input';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

/** httpOnly cookie carrying the opaque guest-cart session token. */
export const GUEST_CART_COOKIE = 'guestCartToken';
/** 30-day guest-cart lifetime (see userActions — abandoned-cart cleanup cron). */
const GUEST_CART_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface GqlContext {
  req: Request & { cookies?: Record<string, string>; user?: { userId: string } };
  res: Response;
}

/**
 * Unauthenticated cart surface for guests. Each write mints (on first use) an
 * httpOnly `guestCartToken` cookie via the GraphQL context response; the cookie
 * is the ONLY handle to the cart, so it's never exposed to JS. On login the
 * auth flow merges this cart into the customer's and clears the cookie.
 */
@Resolver(() => Cart)
export class GuestCartResolver {
  constructor(private readonly cartService: CartService) {}

  private readToken(ctx: GqlContext): string | undefined {
    return ctx.req?.cookies?.[GUEST_CART_COOKIE];
  }

  private issueCookie(ctx: GqlContext, token: string) {
    ctx.res?.cookie(GUEST_CART_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: GUEST_CART_COOKIE_MAX_AGE_MS,
      path: '/',
      domain:
        process.env.NODE_ENV === 'production'
          ? process.env.COOKIE_DOMAIN
          : undefined,
    });
  }

  /** Reads the guest cart from the guestCartToken cookie, or null if none. Public (guest/session-based, no auth). */
  @Query(() => Cart, {
    name: 'guestCart',
    nullable: true,
    description:
      'The current guest cart (from the guestCartToken cookie). Null if none exists yet.',
  })
  guestCart(@Context() ctx: GqlContext) {
    return this.cartService.guestCartByToken(this.readToken(ctx));
  }

  /** Adds a variant to the guest cart; mints + issues the httpOnly guestCartToken on first write. Public (guest/session-based). */
  @Mutation(() => Cart)
  async addToGuestCart(
    @Context() ctx: GqlContext,
    @Args('input') input: AddToCartInput,
  ) {
    const { cart, sessionToken, tokenChanged } = await this.cartService.addGuest(
      this.readToken(ctx),
      input,
    );
    if (tokenChanged) this.issueCookie(ctx, sessionToken);
    return cart;
  }

  /** Sets a guest cart line's quantity (0 removes); may mint the guest cookie. Public (guest/session-based). */
  @Mutation(() => Cart)
  async updateGuestCartItemQty(
    @Context() ctx: GqlContext,
    @Args('input') input: UpdateCartItemQtyInput,
  ) {
    const { cart, sessionToken, tokenChanged } =
      await this.cartService.updateQtyGuest(this.readToken(ctx), input);
    if (tokenChanged) this.issueCookie(ctx, sessionToken);
    return cart;
  }

  /** Removes a variant from the guest cart; may mint the guest cookie. Public (guest/session-based). */
  @Mutation(() => Cart)
  async removeFromGuestCart(
    @Context() ctx: GqlContext,
    @Args('input') input: RemoveCartItemInput,
  ) {
    const { cart, sessionToken, tokenChanged } =
      await this.cartService.removeGuest(this.readToken(ctx), input);
    if (tokenChanged) this.issueCookie(ctx, sessionToken);
    return cart;
  }

  /**
   * Advisory pre-checkout / cart-view validation. Serves signed-in customers
   * (validate their cart) AND guests (validate the cookie cart) via the
   * optional guard: a valid Bearer token populates req.user, otherwise we fall
   * back to the guest cookie. Read-only — never mutates, never throws.
   */
  @Query(() => CartValidationResult, {
    name: 'validateCart',
    description:
      'Advisory stock/price re-validation. Non-mutating; placement keeps the authoritative oversell guard.',
  })
  @UseGuards(OptionalJwtAuthGuard)
  validateCart(@Context() ctx: GqlContext) {
    const userId = ctx.req?.user?.userId;
    if (userId) return this.cartService.validateCustomerCart(userId);
    return this.cartService.validateGuestCart(this.readToken(ctx));
  }
}
