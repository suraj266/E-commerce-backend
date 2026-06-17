import { Field, ID, InputType } from '@nestjs/graphql';
import { PaymentGateway } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/;

/**
 * Customer's checkout payload — replaces the old PlaceOrderInput for
 * gateway-aware checkout.
 */
@InputType()
export class InitiateCheckoutInput {
  @Field(() => ID)
  @IsUUID()
  shippingAddressId: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  billingAddressId?: string;

  @Field(() => PaymentGateway)
  @IsEnum(PaymentGateway)
  gateway: PaymentGateway;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  customerNotes?: string;

  /** Optional — coupon code applied at cart, re-validated server-side. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  couponCode?: string;

  /**
   * Optional buyer GSTIN — captured when the customer ticks "buying for
   * business" at checkout. Printed on the per-seller tax invoice as the
   * recipient GSTIN.
   */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(GSTIN_REGEX, {
    message: 'buyerGstin must be a valid 15-char India GSTIN',
  })
  buyerGstin?: string;
}
