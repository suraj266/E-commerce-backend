import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { WishlistService } from './wishlist.service';
import { Wishlist } from './entities/wishlist.entity';
import { ToggleWishlistInput } from './dto/toggle-wishlist.input';

/**
 * All wishlist endpoints are JWT-gated and customer-only — `WishlistService`
 * looks up the Customer extension and throws ForbiddenException if the
 * caller isn't a storefront customer.
 */
@Resolver(() => Wishlist)
@UseGuards(JwtAuthGuard)
export class WishlistResolver {
  constructor(private readonly wishlistService: WishlistService) {}

  /** The caller's default wishlist with hydrated products (created on first access). Auth: logged-in customer. */
  @Query(() => Wishlist, { name: 'myWishlist' })
  myWishlist(@CurrentUser() user: CurrentUserPayload) {
    return this.wishlistService.myWishlist(user.userId);
  }

  /** Lightweight set of wishlisted product IDs for rendering filled hearts on cards. Auth: logged-in customer. */
  @Query(() => [String], { name: 'myWishlistProductIds' })
  myWishlistProductIds(@CurrentUser() user: CurrentUserPayload) {
    return this.wishlistService.myWishlistProductIds(user.userId);
  }

  /** Add a product to the caller's wishlist (idempotent; validates the product). Auth: logged-in customer. */
  @Mutation(() => Wishlist)
  addToWishlist(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: ToggleWishlistInput,
  ) {
    return this.wishlistService.add(user.userId, input);
  }

  /** Remove a product from the caller's wishlist. Auth: logged-in customer. */
  @Mutation(() => Wishlist)
  removeFromWishlist(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: ToggleWishlistInput,
  ) {
    return this.wishlistService.remove(user.userId, input);
  }

  /** Empty the caller's wishlist entirely. Auth: logged-in customer. */
  @Mutation(() => Wishlist)
  clearWishlist(@CurrentUser() user: CurrentUserPayload) {
    return this.wishlistService.clear(user.userId);
  }
}
