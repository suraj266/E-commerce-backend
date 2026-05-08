import { Field, ID, InputType } from '@nestjs/graphql';
import { PaymentMethod } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

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
}
