import { InputType, Field, ID } from '@nestjs/graphql';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

@InputType()
export class ReorderProductImagesInput {
  @Field(() => ID)
  @IsUUID()
  productId: string;

  @Field(() => [ID], {
    description: 'Image IDs in desired display order (top to bottom)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  imageIds: string[];
}
