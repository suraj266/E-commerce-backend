import { InputType, Field, ID, Float, Int } from '@nestjs/graphql';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';

/**
 * Partial update of a store's shipping configuration. Any omitted field is
 * left unchanged (merged over the current `Store.shippingConfig`). Rate model:
 * FLAT + FREE-OVER-THRESHOLD + PER-KG.
 */
@InputType()
export class UpdateStoreShippingInput {
  @Field(() => ID)
  @IsUUID()
  storeId: string;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  freeAbove?: number | null;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  flatRate?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  perKgRate?: number | null;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  codEnabled?: boolean;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  codLimit?: number | null;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  processingDays?: number | null;

  /** Pincodes this store does NOT deliver to (6-digit Indian PINs). */
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @Matches(/^[1-9][0-9]{5}$/, { each: true, message: 'Each pincode must be a valid 6-digit Indian PIN' })
  excludedPincodes?: string[];
}
