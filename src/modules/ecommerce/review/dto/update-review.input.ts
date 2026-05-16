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
export class UpdateReviewInput {
  @Field(() => ID)
  @IsUUID()
  id: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(5000)
  body?: string;

  /**
   * Replace the review's media set wholesale. Caller is responsible for
   * sending the final list of items (which can include existing items the
   * customer kept + new uploads). Omitting this field leaves media
   * untouched; sending an empty array clears it.
   */
  @Field(() => [ReviewMediaInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => ReviewMediaInput)
  media?: ReviewMediaInput[];
}
