import { ObjectType, Field, ID, Float, Int } from '@nestjs/graphql';

/** One seller's slice of a shipping quote (preview, before placement). */
@ObjectType()
export class SellerShippingQuote {
  @Field(() => ID)
  sellerId: string;

  @Field(() => ID)
  storeId: string;

  @Field(() => String)
  storeName: string;

  /** Customer-facing goods subtotal for this seller (pre-discount). */
  @Field(() => Float)
  merchandiseSubtotal: number;

  /** Tax-inclusive shipping charge for this seller. */
  @Field(() => Float)
  shippingCharge: number;

  /** True when the free-over-threshold applied. */
  @Field(() => Boolean)
  freeApplied: boolean;

  /** The configured free-shipping threshold, for "add ₹X for free shipping" UX. */
  @Field(() => Float, { nullable: true })
  freeAbove?: number | null;

  /** Delivers to the requested pincode. */
  @Field(() => Boolean)
  serviceable: boolean;

  /** COD available for this seller given the cash-collected total + config. */
  @Field(() => Boolean)
  codEligible: boolean;

  /** Informational dispatch/delivery SLA (days). */
  @Field(() => Int, { nullable: true })
  estimatedDispatchDays?: number | null;

  /** 'LIVE' (courier rate) or 'IN_HOUSE' (flat engine). */
  @Field(() => String)
  rateSource: string;

  /** Courier name when the rate is live (e.g. "Bluedart"). */
  @Field(() => String, { nullable: true })
  courierName?: string | null;
}

/** Aggregate shipping quote across all sellers in the cart. */
@ObjectType()
export class ShippingQuote {
  @Field(() => [SellerShippingQuote])
  sellers: SellerShippingQuote[];

  /** Σ per-seller shipping charges. */
  @Field(() => Float)
  shippingTotal: number;

  /** AND across sellers — every seller delivers to the pincode. */
  @Field(() => Boolean)
  serviceable: boolean;

  /** AND across sellers — COD available for the whole order. */
  @Field(() => Boolean)
  codEligible: boolean;

  /** Merchandise + shipping (used for COD-limit display). */
  @Field(() => Float)
  grandTotal: number;
}
