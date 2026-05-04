import { InputType, Field, ID, PartialType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';
import { CreateAttributeInput } from './create-attribute.input';

@InputType()
export class UpdateAttributeInput extends PartialType(CreateAttributeInput) {
  @Field(() => ID)
  @IsUUID()
  id: string;
}
