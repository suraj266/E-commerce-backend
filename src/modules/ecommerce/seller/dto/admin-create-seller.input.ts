import { InputType, Field } from '@nestjs/graphql';
import {
  IsEmail,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';
import { CreateSellerInput, PHONE_REGEX } from './create-seller.input';

/**
 * Admin-only: create a User + Seller atomically.
 *
 * Extends CreateSellerInput (legalName, panNumber, etc.) with the User
 * fields the admin enters on behalf of the new seller. Backend creates the
 * User with role=`seller`, marks email pre-verified (since admin vetted),
 * and immediately marks the Seller VERIFIED so they can list stores.
 */
@InputType()
export class AdminCreateSellerInput extends CreateSellerInput {
  @Field(() => String, { description: 'Full name of the new seller user' })
  @IsString()
  @Length(2, 200)
  userName: string;

  @Field(() => String, { description: 'Login email (must be unique)' })
  @IsEmail()
  userEmail: string;

  @Field(() => String, { description: 'India phone (must be unique)' })
  @IsString()
  @Matches(PHONE_REGEX, { message: 'userPhone must be a valid India phone' })
  userPhone: string;

  @Field(() => String, { description: 'Temporary password — share with seller' })
  @IsString()
  @MinLength(8)
  userPassword: string;
}
