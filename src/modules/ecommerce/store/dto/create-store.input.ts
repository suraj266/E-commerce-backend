import { InputType, Field } from '@nestjs/graphql';
import {
  IsString,
  IsOptional,
  Length,
  IsEmail,
  Matches,
  IsBoolean,
} from 'class-validator';

const PHONE_REGEX = /^(\+?91)?[6-9][0-9]{9}$/;

@InputType()
export class CreateStoreInput {
  @Field(() => String)
  @IsString()
  @Length(2, 200)
  name: string;

  @Field(() => String, { nullable: true, description: 'Auto-generated from name if blank' })
  @IsOptional()
  @IsString()
  slug?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  bannerUrl?: string;

  @Field(() => String, { nullable: true, description: 'ISO 4217 currency code (default: INR)' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currencyCode?: string;

  @Field(() => String, { nullable: true, description: 'IANA timezone (default: Asia/Kolkata)' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @Field(() => String, { nullable: true, description: 'BCP 47 locale (default: en-IN)' })
  @IsOptional()
  @IsString()
  locale?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsEmail()
  supportEmail?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @Matches(PHONE_REGEX, { message: 'supportPhone must be a valid India phone number' })
  supportPhone?: string;

  @Field(() => Boolean, { nullable: true, defaultValue: false })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}
