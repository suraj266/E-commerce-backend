import { ObjectType, Field, Float } from '@nestjs/graphql';
import { Coupon } from './coupon.entity';

/**
 * Result of `validateCoupon` — surfaced to the customer's cart UI.
 *
 * On success: `isValid: true`, populated `discountAmount` + coupon details.
 * On failure: `isValid: false`, `reason` is the user-facing message.
 */
@ObjectType()
export class CouponValidation {
  @Field(() => Boolean)
  isValid: boolean;

  @Field(() => String, { nullable: true })
  reason?: string | null;

  @Field(() => Coupon, { nullable: true })
  coupon?: Coupon | null;

  /** Discount in INR for the current cart subtotal. 0 when invalid. */
  @Field(() => Float)
  discountAmount: number;

  /** Subtotal we computed the discount against (useful for UI sanity). */
  @Field(() => Float)
  subtotal: number;
}
