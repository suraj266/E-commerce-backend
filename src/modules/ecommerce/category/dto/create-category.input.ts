import { InputType, Field, Int } from '@nestjs/graphql';
import { IsString, IsOptional, IsBoolean, IsInt } from 'class-validator';

@InputType()
export class CreateCategoryInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  parentId?: string;

  @Field(() => String)
  @IsString()
  name: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  slug?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  iconUrl?: string;

  @Field(() => Int, { defaultValue: 0 })
  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @Field(() => Boolean, { defaultValue: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
