import { Field, ID, InputType, Float, Int } from '@nestjs/graphql';
import {
  PaymentGateway,
  ProcessingFeeType,
  GatewayPaymentType,
} from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

@InputType()
export class CreateGatewayConfigInput {
  @Field(() => PaymentGateway)
  @IsEnum(PaymentGateway)
  gateway: PaymentGateway;

  @Field(() => String)
  @IsString()
  @MaxLength(100)
  displayName: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @Field(() => Boolean, { defaultValue: false })
  @IsBoolean()
  isEnabled: boolean;

  @Field(() => Boolean, { defaultValue: false })
  @IsBoolean()
  isDefault: boolean;

  @Field(() => Int, { defaultValue: 0 })
  @IsNumber()
  @Min(0)
  displayOrder: number;

  @Field(() => [String], { defaultValue: [] })
  @IsArray()
  @IsString({ each: true })
  supportedMethods: string[];

  /**
   * Raw credentials JSON string — will be encrypted before storage.
   * e.g. '{"keyId":"rzp_test_xxx","keySecret":"xxx","webhookSecret":"xxx"}'
   */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  credentialsJson?: string;

  @Field(() => Boolean, { defaultValue: true })
  @IsBoolean()
  sandboxMode: boolean;

  @Field(() => Float, { defaultValue: 0 })
  @IsNumber()
  @Min(0)
  processingFee: number;

  @Field(() => ProcessingFeeType, { defaultValue: 'FIXED' })
  @IsEnum(ProcessingFeeType)
  processingFeeType: ProcessingFeeType;

  @Field(() => GatewayPaymentType, { defaultValue: 'WEBSITE_EMBEDDED' })
  @IsEnum(GatewayPaymentType)
  paymentType: GatewayPaymentType;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  instructions?: string;
}

@InputType()
export class UpdateGatewayConfigInput {
  @Field(() => ID)
  @IsUUID()
  id: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  displayOrder?: number;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supportedMethods?: string[];

  /** Pass new credentials to re-encrypt. Omit to keep existing. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  credentialsJson?: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  sandboxMode?: boolean;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  processingFee?: number;

  @Field(() => ProcessingFeeType, { nullable: true })
  @IsOptional()
  @IsEnum(ProcessingFeeType)
  processingFeeType?: ProcessingFeeType;

  @Field(() => GatewayPaymentType, { nullable: true })
  @IsOptional()
  @IsEnum(GatewayPaymentType)
  paymentType?: GatewayPaymentType;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  instructions?: string;
}
