import { Field, Float, InputType, Int } from '@nestjs/graphql';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const DISCOUNT_TYPES = ['percentage', 'fixed_amount'] as const;

@InputType()
export class CreateCouponInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  storeId?: string;

  @Field(() => String)
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'Code must use letters, digits, hyphens, or underscores only.',
  })
  code: string;

  @Field(() => String)
  @IsString()
  @MaxLength(120)
  name: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @Field(() => String)
  @IsString()
  @IsIn(DISCOUNT_TYPES)
  discountType: 'percentage' | 'fixed_amount';

  @Field(() => Float)
  @IsNumber()
  @Min(0.01)
  discountValue: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumPurchaseAmount?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maximumDiscountAmount?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  usageLimitPerUser?: number;

  @Field(() => String)
  @IsDateString()
  validFrom: string;

  @Field(() => String)
  @IsDateString()
  validUntil: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
