import { ObjectType, Field, ID, Float } from '@nestjs/graphql';
import { RefundEntity } from './refund.entity';

/**
 * SellerRefundPreview — everything the seller's refund dialog needs to render
 * the money breakdown and pre-fill the amount, WITHOUT ever exposing the parent
 * order's other seller slices.
 *
 * Deliberately non-throwing: when a refund isn't possible the query still
 * resolves with `refundable: false` + a human `blockedReason`, so the UI can
 * explain why instead of showing a generic GraphQL error. The mutation is the
 * one that enforces the same rules hard.
 */
@ObjectType()
export class SellerRefundPreview {
  @Field(() => ID)
  sellerOrderId: string;

  @Field(() => String)
  orderNumber: string;

  @Field(() => String)
  currencyCode: string;

  // ---- What the buyer paid for THIS seller's slice ----

  @Field(() => Float)
  subtotal: number;

  @Field(() => Float)
  taxAmount: number;

  @Field(() => Float)
  shippingAmount: number;

  @Field(() => Float)
  discountAmount: number;

  /** subtotal + tax + shipping − discount. The slice's gross value. */
  @Field(() => Float)
  sliceTotal: number;

  // ---- Refund state ----

  /** Sum of PROCESSING + PROCESSED refunds already booked against this slice. */
  @Field(() => Float)
  alreadyRefunded: number;

  /**
   * The hard ceiling this seller may refund now:
   * min(payment remaining, sliceTotal − alreadyRefunded), floored at 0.
   */
  @Field(() => Float)
  maxRefundable: number;

  /** Whether a refund can be created right now. */
  @Field(() => Boolean)
  refundable: boolean;

  /** Human explanation when `refundable` is false. */
  @Field(() => String, { nullable: true })
  blockedReason?: string | null;

  /** 'RAZORPAY' | 'COD' | … — so the dialog can say where the money goes back to. */
  @Field(() => String, { nullable: true })
  paymentGateway?: string | null;

  /** Prior refunds on this slice, newest first — shown as history in the dialog. */
  @Field(() => [RefundEntity])
  refunds: RefundEntity[];
}
