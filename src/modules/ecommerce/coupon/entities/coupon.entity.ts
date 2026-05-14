import { ObjectType, Field, ID, Int, Float } from '@nestjs/graphql';

@ObjectType()
export class Coupon {
  @Field(() => ID)
  id: string;

  @Field(() => ID, { nullable: true })
  storeId?: string | null;

  @Field(() => String)
  code: string;

  @Field(() => String)
  name: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  /** "percentage" | "fixed_amount" */
  @Field(() => String)
  discountType: string;

  @Field(() => Float)
  discountValue: number;

  @Field(() => Float, { nullable: true })
  minimumPurchaseAmount?: number | null;

  @Field(() => Float, { nullable: true })
  maximumDiscountAmount?: number | null;

  @Field(() => Int, { nullable: true })
  usageLimit?: number | null;

  @Field(() => Int, { nullable: true })
  usageLimitPerUser?: number | null;

  @Field(() => Date)
  validFrom: Date;

  @Field(() => Date)
  validUntil: Date;

  @Field(() => Boolean)
  isActive: boolean;

  /** Total redemptions to date — computed on read. */
  @Field(() => Int, { nullable: true })
  redemptionCount?: number | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}
