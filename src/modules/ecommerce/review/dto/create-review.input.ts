import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ReviewMediaInput } from './review-media.input';

@InputType()
export class CreateReviewInput {
  @Field(() => ID)
  @IsUUID()
  productId: string;

  /** 1..5 inclusive. */
  @Field(() => Int)
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @Field(() => String)
  @IsString()
  @MinLength(2)
  @MaxLength(5000)
  body: string;

  /** Up to 5 images + 1 video. Service enforces the per-type split. */
  @Field(() => [ReviewMediaInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => ReviewMediaInput)
  media?: ReviewMediaInput[];
}
