import { CreateCategoryInput } from './create-category.input';
import { InputType, Field, PartialType, ID } from '@nestjs/graphql';
import { IsString } from 'class-validator';

@InputType()
export class UpdateCategoryInput extends PartialType(CreateCategoryInput) {
  @Field(() => ID)
  @IsString()
  id: string;
}
