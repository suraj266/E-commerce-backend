import { Field, InputType } from '@nestjs/graphql';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

/**
 * Customer self-serve profile update. Subset of `UpdateCustomerInput` —
 * notably *excludes* `status`, `email`, and `id` (the customer can't
 * suspend themselves and the row is identified via the JWT). Email
 * changes belong on a separate flow that re-verifies ownership.
 */
@InputType()
export class UpdateMyProfileInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  phone?: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  marketingOptIn?: boolean;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  preferredCurrency?: string;
}
