import { InputType, Field, ID, Float } from '@nestjs/graphql';

/**
 * RequestRefundInput — customer-initiated refund request.
 *
 * Provide exactly one scope: `orderId` (refund the whole order across all
 * seller slices) OR `sellerOrderId` (refund a single seller's slice). `amount`
 * is optional — omitted means "the full remaining refundable amount for the
 * scope". `restock` marks whether the lines return to sellable inventory when
 * the refund is approved.
 */
@InputType()
export class RequestRefundInput {
  @Field(() => ID, { nullable: true })
  orderId?: string;

  @Field(() => ID, { nullable: true })
  sellerOrderId?: string;

  @Field(() => Float, { nullable: true })
  amount?: number;

  @Field(() => String, { nullable: true })
  reason?: string;

  @Field(() => Boolean, { nullable: true })
  restock?: boolean;
}
