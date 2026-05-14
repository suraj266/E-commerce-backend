import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Customer-facing — passes the code typed in the cart UI. The current
 * customer's cart contents are read from the DB; the client doesn't need
 * to send line items.
 */
@InputType()
export class ValidateCouponInput {
  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code: string;
}
