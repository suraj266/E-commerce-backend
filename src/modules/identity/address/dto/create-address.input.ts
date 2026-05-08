import { Field, InputType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { AddressType } from '../entities/address.entity';

@InputType()
export class CreateAddressInput {
  @Field(() => AddressType)
  @IsEnum(AddressType)
  type: AddressType;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  label?: string;

  @Field(() => String)
  @IsString()
  @Length(1, 100)
  firstName: string;

  @Field(() => String)
  @IsString()
  @Length(1, 100)
  lastName: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  phone?: string;

  @Field(() => String)
  @IsString()
  @Length(1, 200)
  addressLine1: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  addressLine2?: string;

  @Field(() => String)
  @IsString()
  @Length(1, 100)
  city: string;

  @Field(() => String)
  @IsString()
  @Length(1, 100)
  state: string;

  @Field(() => String)
  @IsString()
  @Length(3, 12)
  postalCode: string;

  @Field(() => String)
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode must be ISO 3166-1 alpha-2' })
  countryCode: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
