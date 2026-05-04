import { InputType, Field, ID, Float } from '@nestjs/graphql';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

@InputType()
export class VariantAxisValuesInput {
  @Field(() => ID)
  @IsUUID()
  attributeId: string;

  @Field(() => [ID], { description: 'Selected value IDs to include in the matrix' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  valueIds: string[];
}

@InputType()
export class GenerateVariantMatrixInput {
  @Field(() => ID)
  @IsUUID()
  productId: string;

  @Field(() => [VariantAxisValuesInput])
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => VariantAxisValuesInput)
  axes: VariantAxisValuesInput[];

  @Field(() => Float, { description: 'Default price applied to all generated variants' })
  @IsNumber()
  @Min(0)
  basePrice: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  baseCompareAtPrice?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  baseCostPrice?: number;
}
