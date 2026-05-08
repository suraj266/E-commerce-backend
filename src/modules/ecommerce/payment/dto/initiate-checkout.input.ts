import { Field, ID, InputType } from '@nestjs/graphql';
import { PaymentGateway } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

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
}
