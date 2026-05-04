import { InputType, Field, ID, OmitType, PartialType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';
import { CreateAttributeValueInput } from './create-attribute-value.input';

@InputType()
export class UpdateAttributeValueInput extends PartialType(
  OmitType(CreateAttributeValueInput, ['attributeId'] as const),
) {
  @Field(() => ID)
  @IsUUID()
  id: string;
}
