import { InputType, Field, ID } from '@nestjs/graphql';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

@InputType()
export class ReorderAttributeValuesInput {
  @Field(() => ID)
  @IsUUID()
  attributeId: string;

  @Field(() => [ID], {
    description: 'Value IDs in the desired display order (top to bottom)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  valueIds: string[];
}
