import { InputType, Field, ID, PartialType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';
import { CreateTagInput } from './create-tag.input';

@InputType()
export class UpdateTagInput extends PartialType(CreateTagInput) {
  @Field(() => ID)
  @IsUUID()
  id: string;
}
