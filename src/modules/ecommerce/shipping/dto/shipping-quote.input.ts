import { InputType, Field, ID } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

/**
 * Shipping-quote request. The cart is always read server-side (never trusted
 * from the client). Provide either a saved `addressId` (preferred — gives the
 * exact delivery pincode) or a raw `pincode` (cart-page "check delivery" before
 * an address is chosen). `couponCode` lets COD eligibility reflect the
 * post-discount cash total.
 */
@InputType()
export class ShippingQuoteInput {
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  addressId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @Matches(/^[1-9][0-9]{5}$/, { message: 'pincode must be a valid 6-digit Indian PIN' })
  pincode?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  couponCode?: string;
}
