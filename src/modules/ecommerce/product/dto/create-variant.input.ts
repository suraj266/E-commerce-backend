import { InputType, Field, ID, Float } from '@nestjs/graphql';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

@InputType()
export class CreateVariantInput {
  @Field(() => ID)
  @IsUUID()
  productId: string;

  @Field(() => [ID], {
    description: 'Attribute value IDs that define this variant — one per axis',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  attributeValueIds: string[];

  @Field(() => String, { nullable: true, description: 'Auto-generated from attribute slugs if blank' })
  @IsOptional()
  @IsString()
  @Length(2, 60)
  sku?: string;

  @Field(() => Float)
  @IsNumber()
  @Min(0)
  price: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  compareAtPrice?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  imageUrl?: string;
}
