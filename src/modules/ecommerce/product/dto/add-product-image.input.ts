import { InputType, Field, ID, Int } from '@nestjs/graphql';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

@InputType()
export class AddProductImageInput {
  @Field(() => ID)
  @IsUUID()
  productId: string;

  @Field(() => String, { description: 'Canonical URL from Image module upload' })
  @IsString()
  imageUrl: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  altText?: string;

  @Field(() => Boolean, { nullable: true, defaultValue: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
