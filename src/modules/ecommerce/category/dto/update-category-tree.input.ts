import { InputType, Field, Int, ID } from '@nestjs/graphql';
import { IsString, IsOptional, IsInt, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

@InputType()
export class CategoryTreeItemInput {
  @Field(() => ID)
  @IsString()
  id: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @Field(() => Int)
  @IsInt()
  displayOrder: number;
}

@InputType()
export class UpdateCategoryTreeInput {
  @Field(() => [CategoryTreeItemInput])
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoryTreeItemInput)
  items: CategoryTreeItemInput[];
}
