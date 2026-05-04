import { InputType, Field, ID } from '@nestjs/graphql';
import {
  IsString,
  IsOptional,
  Length,
  IsBoolean,
  IsUUID,
  Matches,
} from 'class-validator';

const PHONE_REGEX = /^(\+?91)?[6-9][0-9]{9}$/;
const PINCODE_REGEX = /^[1-9][0-9]{5}$/;

@InputType()
export class CreateWarehouseInput {
  @Field(() => ID)
  @IsUUID()
  storeId: string;

  @Field(() => String)
  @IsString()
  @Length(2, 100)
  name: string;

  @Field(() => String, { description: 'Short unique-per-store code, e.g. MUM01' })
  @IsString()
  @Length(2, 30)
  code: string;

  @Field(() => String)
  @IsString()
  @Length(2, 200)
  addressLine1: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  addressLine2?: string;

  @Field(() => String)
  @IsString()
  @Length(2, 100)
  city: string;

  @Field(() => String)
  @IsString()
  @Length(2, 100)
  state: string;

  @Field(() => String)
  @Matches(PINCODE_REGEX, { message: 'postalCode must be a valid 6-digit India pincode' })
  postalCode: string;

  @Field(() => String, { nullable: true, description: 'ISO 3166-1 alpha-2 (default: IN)' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @Matches(PHONE_REGEX, { message: 'phone must be a valid India phone number' })
  phone?: string;

  @Field(() => Boolean, { nullable: true, defaultValue: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
