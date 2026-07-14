import { Field, ID, InputType } from '@nestjs/graphql';
import { PaymentMethod } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

// 15-char GSTIN. Same regex used elsewhere — kept inline so this DTO
// has no module-cross imports.
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/;

/**
 * Customer's checkout payload.
 *
 * Cart contents come from the server's stored cart — we never trust
 * client-supplied prices or quantities. The customer only chooses:
 *   - which saved address to ship to (and bill to, if different)
 *   - the payment method (only COD is live for v1)
 *   - optional note to the seller
 */
@InputType()
export class PlaceOrderInput {
  @Field(() => ID)
  @IsUUID()
  shippingAddressId: string;

  /** Defaults to shippingAddressId when omitted. */
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  billingAddressId?: string;

  @Field(() => PaymentMethod, { defaultValue: PaymentMethod.COD })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  customerNotes?: string;

  /** Optional — coupon code typed at cart/checkout. Re-validated server-side. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  couponCode?: string;

  /**
   * Optional buyer GSTIN — set when the customer ticks "buying for business"
   * at checkout. Stored on Order and printed on each per-seller tax invoice
   * as the recipient GSTIN (CGST Rule 46). Validated for format only;
   * actual GSTIN verification with the GST portal is a Phase 5 addition.
   */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(GSTIN_REGEX, {
    message: 'buyerGstin must be a valid 15-char India GSTIN',
  })
  buyerGstin?: string;

  /**
   * Idempotency key — a UUID the client generates once per checkout attempt and
   * reuses on retry. Guards against double-submit / network-retry creating
   * duplicate orders (see OrderPlacementService.placeOrder). Optional for
   * backward compatibility; when omitted no idempotency protection applies.
   */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  clientRequestId?: string;
}
