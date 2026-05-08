import { Field, ID, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Frontend sends this after the gateway SDK reports a successful payment.
 * Belt-and-suspenders verification — the webhook handles the primary
 * confirmation, but this lets us update the UI immediately.
 */
@InputType()
export class VerifyPaymentInput {
  @Field(() => ID)
  @IsUUID()
  orderId: string;

  @Field(() => String)
  @IsString()
  gatewayPaymentId: string;

  @Field(() => String)
  @IsString()
  gatewaySignature: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  gatewayOrderId?: string;
}
