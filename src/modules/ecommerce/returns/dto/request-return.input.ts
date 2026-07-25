import { InputType, Field, ID, Int } from '@nestjs/graphql';
import { ReturnResolutionType } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

@InputType()
export class RequestReturnItemInput {
  @Field(() => ID)
  @IsString()
  orderItemId: string;

  @Field(() => Int)
  @IsInt()
  @Min(1)
  quantity: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  condition?: string;
}

@InputType()
export class RequestReturnInput {
  /** The delivered SellerOrder the customer is returning items from. */
  @Field(() => ID)
  @IsString()
  sellerOrderId: string;

  @Field(() => String)
  @IsString()
  @MaxLength(500)
  reason: string;

  /**
   * How the customer wants the return resolved. Defaults to REFUND. REPLACEMENT
   * is accepted only when the feature flag is on (replacementEnabled()) — the
   * service rejects it otherwise. // NEEDS PRODUCT SIGN-OFF on the flag.
   */
  @Field(() => ReturnResolutionType, { nullable: true })
  @IsOptional()
  @IsEnum(ReturnResolutionType)
  resolutionType?: ReturnResolutionType;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customerNote?: string;

  @Field(() => [RequestReturnItemInput])
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RequestReturnItemInput)
  items: RequestReturnItemInput[];
}
