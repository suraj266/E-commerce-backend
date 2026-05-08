import { Field, ID, InputType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

/**
 * Admin-side update for a single customer. Partial — only the fields the
 * admin actually changed need to be present. Email and password are NOT
 * editable here; those go through dedicated flows (admin verify-email,
 * customer self-serve password reset).
 */
@InputType()
export class UpdateCustomerInput {
  @Field(() => ID)
  @IsUUID()
  id: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  phone?: string;

  /** "active" | "inactive" | "suspended" | "banned" — mirrors User.status. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsIn(['active', 'inactive', 'suspended', 'banned'])
  status?: string;

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
