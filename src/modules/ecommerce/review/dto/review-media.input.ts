import { Field, InputType, Int } from '@nestjs/graphql';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ReviewMediaType } from '../entities/review.entity';

/**
 * A single media item attached to a review on create/update. The customer
 * uploads the file via /media/review/upload first, then posts the returned
 * URL + metadata here.
 */
@InputType()
export class ReviewMediaInput {
  @Field(() => ReviewMediaType)
  @IsEnum(ReviewMediaType)
  type: ReviewMediaType;

  @Field(() => String)
  @IsString()
  @MaxLength(500)
  url: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  width?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  height?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationMs?: number;

  @Field(() => Int)
  @IsInt()
  @Min(0)
  sizeBytes: number;
}
