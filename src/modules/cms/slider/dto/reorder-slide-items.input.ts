import { InputType, Field, ID } from '@nestjs/graphql';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

@InputType()
export class ReorderSlideItemsInput {
  @Field(() => ID)
  @IsUUID()
  sliderId: string;

  @Field(() => [ID], {
    description: 'Slide item IDs in their new order (top → bottom).',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  itemIds: string[];
}
