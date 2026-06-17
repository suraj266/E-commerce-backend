import { ObjectType, Field, Float, Int } from '@nestjs/graphql';

/**
 * Per-store shipping configuration, surfaced from `Store.shippingConfig` (Json).
 * Coerced to safe defaults by `parseShippingConfig` (shipping-rate.ts) so the
 * `flatRate` field is always present even for a never-configured store.
 *
 * Rate model: FLAT + FREE-OVER-THRESHOLD + PER-KG (see shipping-rate.ts).
 */
@ObjectType()
export class ShippingConfig {
  /** Order subtotal (₹) at/above which shipping is free. Null = never free. */
  @Field(() => Float, { nullable: true })
  freeAbove?: number | null;

  /** Base shipping charge (₹) when not free. */
  @Field(() => Float)
  flatRate: number;

  /** Additional ₹ per billable kg. */
  @Field(() => Float, { nullable: true })
  perKgRate?: number | null;

  /** Whether this store offers Cash on Delivery. */
  @Field(() => Boolean)
  codEnabled: boolean;

  /** Max order value (₹) eligible for COD. Null = no limit. */
  @Field(() => Float, { nullable: true })
  codLimit?: number | null;

  /** Informational dispatch SLA shown to buyers. */
  @Field(() => Int, { nullable: true })
  processingDays?: number | null;

  /** Pincodes this store does NOT deliver to. */
  @Field(() => [String], { nullable: true })
  excludedPincodes?: string[];
}
