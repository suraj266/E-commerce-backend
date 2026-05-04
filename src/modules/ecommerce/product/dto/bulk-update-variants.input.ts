import { InputType, Field, ID, Float } from '@nestjs/graphql';
import { VariantStatus } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

/**
 * Bulk apply a value to multiple variants at once. Filter narrows which
 * variants are touched (e.g. "all variants having Color: Red"). At least
 * one of the patch fields must be set.
 */
@InputType()
export class BulkUpdateVariantsInput {
  @Field(() => ID)
  @IsUUID()
  productId: string;

  @Field(() => [ID], {
    nullable: true,
    description: 'Optional filter: only update variants having ANY of these attribute value IDs',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  filterValueIds?: string[];

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  compareAtPrice?: number;

  @Field(() => VariantStatus, { nullable: true })
  @IsOptional()
  @IsEnum(VariantStatus)
  status?: VariantStatus;
}
