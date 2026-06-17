import { InputType, Field, ID, Int } from '@nestjs/graphql';
import { CollectionStatus, CollectionType } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

@InputType()
export class CreateCollectionInput {
  @Field(() => String)
  @IsString()
  @Length(2, 120)
  name: string;

  @Field(() => String, { nullable: true, description: 'Auto-generated from name if blank' })
  @IsOptional()
  @IsString()
  slug?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  bannerUrl?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @Field(() => CollectionType, { defaultValue: CollectionType.MANUAL })
  @IsEnum(CollectionType)
  type: CollectionType;

  /** JSON-encoded RuleSet — required when type=SMART, ignored for MANUAL. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  rule?: string;

  /** MANUAL membership — product ids to include. Ignored for SMART. */
  @Field(() => [ID], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  productIds?: string[];

  @Field(() => CollectionStatus, { nullable: true, defaultValue: CollectionStatus.ACTIVE })
  @IsOptional()
  @IsEnum(CollectionStatus)
  status?: CollectionStatus;

  @Field(() => Boolean, { nullable: true, defaultValue: false })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @Field(() => Int, { nullable: true, defaultValue: 0 })
  @IsOptional()
  @IsInt()
  displayOrder?: number;
}
