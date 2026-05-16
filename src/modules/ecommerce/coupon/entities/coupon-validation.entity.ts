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

  /** Pre-tax discount (e.g. 10% × ₹100 = ₹10). 0 when invalid. */
  @Field(() => Float)
  discountAmount: number;

  /** Pre-tax cart subtotal. */
  @Field(() => Float)
  subtotal: number;

  /** Tax-inclusive subtotal — what the cart displays when prices show tax. */
  @Field(() => Float)
  subtotalInclTax: number;

  /**
   * Effective discount on the tax-inclusive total (= subtotalInclTax − customerTotal).
   * Larger than `discountAmount` when discount triggers a GST reduction
   * on the discounted taxable value (CGST Act §15(3)(a)).
   */
  @Field(() => Float)
  discountInclTax: number;

  /**
   * Final amount the customer pays at checkout, including GST computed on
   * the post-discount taxable value. Matches Order.totalAmount at placement.
   */
  @Field(() => Float)
  customerTotal: number;
}
