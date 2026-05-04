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
export class UpdateProductImageInput {
  @Field(() => ID)
  @IsUUID()
  id: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  altText?: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
