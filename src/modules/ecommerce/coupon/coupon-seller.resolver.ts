/**
 * Seller-facing coupon resolver — store-scoped CRUD for a store owner.
 *
 * The admin resolver (coupon-admin.resolver.ts) is `coupon:*` permission-gated
 * and NOT ownership-scoped, so sellers can't use it. This resolver is guarded
 * by JwtAuthGuard only; every operation delegates to the CouponService
 * `*ForSeller` methods, which resolve the caller → seller and assert the
 * target store/coupon belongs to a store that seller owns. Ownership lives in
 * the service, so a forged storeId / coupon id can never reach another
 * seller's data.
 */

import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';

import { CouponService } from './coupon.service';
import { Coupon } from './entities/coupon.entity';
import { CreateCouponInput } from './dto/create-coupon.input';
import { UpdateCouponInput } from './dto/update-coupon.input';

import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';

@Resolver(() => Coupon)
@UseGuards(JwtAuthGuard)
export class CouponSellerResolver {
  constructor(private readonly service: CouponService) {}

  /** Lists coupons across the caller's own stores; pass storeId to scope to one owned store. Auth: logged-in seller. */
  @Query(() => [Coupon], { name: 'myStoreCoupons' })
  myStoreCoupons(
    @CurrentUser() user: CurrentUserPayload,
    @Args('storeId', { type: () => ID, nullable: true })
    storeId?: string | null,
  ) {
    return this.service.listForSeller(user.userId, storeId);
  }

  /** Creates a coupon scoped to one of the caller's own stores (storeId required + ownership-checked). Auth: logged-in seller. */
  @Mutation(() => Coupon, { name: 'createMyStoreCoupon' })
  createMyStoreCoupon(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: CreateCouponInput,
  ) {
    return this.service.createForSeller(user.userId, input);
  }

  /** Updates one of the caller's own store coupons (ownership-checked). Auth: logged-in seller. */
  @Mutation(() => Coupon, { name: 'updateMyStoreCoupon' })
  updateMyStoreCoupon(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: UpdateCouponInput,
  ) {
    return this.service.updateForSeller(user.userId, input);
  }

  /** Soft-deletes one of the caller's own store coupons (ownership-checked); returns null. Auth: logged-in seller. */
  @Mutation(() => Coupon, { name: 'removeMyStoreCoupon', nullable: true })
  async removeMyStoreCoupon(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    await this.service.softDeleteForSeller(user.userId, id);
    return null;
  }
}
