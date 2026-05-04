import { InputType, Field, Float } from '@nestjs/graphql';
import { BusinessType } from '@prisma/client';
import {
  registerEnumType,
} from '@nestjs/graphql';
import {
  IsString,
  IsOptional,
  Length,
  Matches,
  IsNumber,
  Min,
  Max,
  IsEmail,
  IsEnum,
  IsDate,
} from 'class-validator';

registerEnumType(BusinessType, { name: 'BusinessType' });

// India PAN: 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F)
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
// India GSTIN: 15 chars — 2 digit state + 10 char PAN + 1 entity + 1 Z + 1 checksum
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/;
// India phone: 10 digits, optional +91
const PHONE_REGEX = /^(\+?91)?[6-9][0-9]{9}$/;

/**
 * Self-onboarding input. userId is NOT accepted from client — taken from JWT.
 * Used to create the initial DRAFT seller record.
 */
@InputType()
export class CreateSellerInput {
  @Field(() => String, { description: 'Legal/registered business name' })
  @IsString()
  @Length(2, 200)
  legalName: string;

  @Field(() => String, { description: 'Storefront / brand name' })
  @IsString()
  @Length(2, 200)
  displayName: string;

  @Field(() => BusinessType)
  @IsEnum(BusinessType)
  businessType: BusinessType;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  @IsDate()
  dateOfIncorporation?: Date;

  @Field(() => String, { nullable: true, description: 'CIN / LLPIN / etc.' })
  @IsOptional()
  @IsString()
  @Length(2, 50)
  registrationNumber?: string;

  @Field(() => String, { description: 'India PAN (10 chars)' })
  @IsString()
  @Matches(PAN_REGEX, {
    message: 'panNumber must be a valid India PAN (e.g. ABCDE1234F)',
  })
  panNumber: string;

  @Field(() => String, { nullable: true, description: '15-char GSTIN' })
  @IsOptional()
  @IsString()
  @Matches(GSTIN_REGEX, {
    message: 'gstin must be a valid 15-char India GSTIN',
  })
  gstin?: string;

  @Field(() => String)
  @IsEmail()
  businessEmail: string;

  @Field(() => String)
  @IsString()
  @Matches(PHONE_REGEX, { message: 'businessPhone must be a valid India phone' })
  businessPhone: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsEmail()
  supportEmail?: string;

  // Authorized signatory — required for non-individual entities,
  // enforced at service layer based on businessType.
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  signatoryName?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(PAN_REGEX, { message: 'signatoryPan must be a valid India PAN' })
  signatoryPan?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  signatoryDesignation?: string;

  @Field(() => Float, { nullable: true, defaultValue: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  commissionRate?: number;
}

export { PAN_REGEX, GSTIN_REGEX, PHONE_REGEX };
