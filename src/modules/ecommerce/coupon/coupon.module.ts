/**
 * CouponModule — admin CRUD + customer validate.
 *
 * Exports CouponService so OrderModule's placement transaction can call
 * `validateAndCompute()` at the moment of order creation.
 */

import { Module } from '@nestjs/common';

import { CouponService } from './coupon.service';
import { CouponAdminResolver } from './coupon-admin.resolver';
import { CouponCustomerResolver } from './coupon-customer.resolver';
import { CouponSellerResolver } from './coupon-seller.resolver';

@Module({
  providers: [
    CouponService,
    CouponAdminResolver,
    CouponCustomerResolver,
    CouponSellerResolver,
  ],
  exports: [CouponService],
})
export class CouponModule {}
