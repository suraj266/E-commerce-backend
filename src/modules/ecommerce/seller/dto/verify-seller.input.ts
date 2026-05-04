import { InputType, Field, ID, registerEnumType } from '@nestjs/graphql';
import { IsUUID, IsBoolean, IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { SellerStatus } from '@prisma/client';

registerEnumType(SellerStatus, { name: 'SellerStatus' });

export enum SellerVerificationSection {
  PAN = 'PAN',
  GSTIN = 'GSTIN',
  BANK = 'BANK',
  DOCUMENTS = 'DOCUMENTS',
}
registerEnumType(SellerVerificationSection, {
  name: 'SellerVerificationSection',
});

/**
 * Admin marks one verification section as approved or unapproved.
 * Service derives `overallStatus` from the combined section state.
 */
@InputType()
export class VerifySellerSectionInput {
  @Field(() => ID)
  @IsUUID()
  id: string;

  @Field(() => SellerVerificationSection)
  @IsEnum(SellerVerificationSection)
  section: SellerVerificationSection;

  @Field(() => Boolean)
  @IsBoolean()
  verified: boolean;
}

/**
 * Admin override for the overall seller status.
 * Use for: marking REJECTED with reason, or SUSPENDED post-verification.
 */
@InputType()
export class SetSellerStatusInput {
  @Field(() => ID)
  @IsUUID()
  id: string;

  @Field(() => SellerStatus)
  @IsEnum(SellerStatus)
  status: SellerStatus;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}
