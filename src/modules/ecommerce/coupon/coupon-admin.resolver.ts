import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';

import { CouponService } from './coupon.service';
import { Coupon } from './entities/coupon.entity';
import { CreateCouponInput } from './dto/create-coupon.input';
import { UpdateCouponInput } from './dto/update-coupon.input';

import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';

@Resolver(() => Coupon)
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CouponAdminResolver {
  constructor(private readonly service: CouponService) {}

  @Permissions('coupon:read')
  @Query(() => [Coupon], { name: 'adminCoupons' })
  list(
    @Args('search', { type: () => String, nullable: true })
    search?: string | null,
    @Args('status', { type: () => String, nullable: true })
    status?: 'active' | 'inactive' | 'expired' | null,
  ) {
    return this.service.list({ search, status });
  }

  @Permissions('coupon:read')
  @Query(() => Coupon, { name: 'adminCoupon' })
  getById(@Args('id', { type: () => ID }) id: string) {
    return this.service.getById(id);
  }

  @Permissions('coupon:create')
  @Mutation(() => Coupon)
  createCoupon(@Args('input') input: CreateCouponInput) {
    return this.service.create(input);
  }

  @Permissions('coupon:update')
  @Mutation(() => Coupon)
  updateCoupon(@Args('input') input: UpdateCouponInput) {
    return this.service.update(input);
  }

  @Permissions('coupon:delete')
  @Mutation(() => Coupon, { nullable: true })
  async removeCoupon(@Args('id', { type: () => ID }) id: string) {
    await this.service.softDelete(id);
    return null;
  }
}
