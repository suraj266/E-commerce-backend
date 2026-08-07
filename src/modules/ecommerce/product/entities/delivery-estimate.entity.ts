import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

/**
 * Storefront delivery estimate for a product/variant → pincode (P4-B).
 *
 * Read-only: computed by reusing the SAME serviceability engine as checkout —
 * a LIVE per-seller courier rate (CourierService.resolveSellerRate, which
 * yields an ETA in days) when the seller has a courier connected, degrading
 * gracefully to the in-house `Store.shippingConfig` (flat rate + dispatch SLA)
 * when there is no live rate. This is an INDICATIVE hint for the PDP, not a
 * binding quote — the authoritative charge/ETA is re-derived at order placement.
 */
@ObjectType()
export class DeliveryEstimate {
  /** The pincode the estimate was computed for (echoed back, normalized). */
  @Field(() => String)
  pincode: string;

  /** Whether the seller delivers to this pincode at all. */
  @Field(() => Boolean)
  serviceable: boolean;

  /** Seller dispatch/handling SLA in days (from shippingConfig.processingDays). */
  @Field(() => Int, { nullable: true })
  estimatedDispatchDays?: number | null;

  /** Earliest expected doorstep delivery, in days from order (dispatch + transit). */
  @Field(() => Int, { nullable: true })
  minDeliveryDays?: number | null;

  /** Latest expected doorstep delivery, in days from order (dispatch + transit). */
  @Field(() => Int, { nullable: true })
  maxDeliveryDays?: number | null;

  /** 'LIVE' (courier serviceability), 'IN_HOUSE' (flat engine), or 'NONE' (not serviceable). */
  @Field(() => String)
  rateSource: string;

  /** Courier name when the estimate came from a live rate (e.g. "Bluedart"). */
  @Field(() => String, { nullable: true })
  courierName?: string | null;

  /** Indicative shipping charge for a single unit (tax-inclusive), if serviceable. */
  @Field(() => Float, { nullable: true })
  shippingCharge?: number | null;

  /** True when a single unit already crosses the store's free-shipping threshold. */
  @Field(() => Boolean)
  freeShipping: boolean;

  /** Whether Cash on Delivery is available for this seller at the estimated total. */
  @Field(() => Boolean)
  codAvailable: boolean;

  /** Human-friendly note, primarily for the not-serviceable case. */
  @Field(() => String, { nullable: true })
  message?: string | null;
}
