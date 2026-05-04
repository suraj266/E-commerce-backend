import { InputType, Field, ID } from '@nestjs/graphql';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

@InputType()
export class SetVariantAxesInput {
  @Field(() => ID)
  @IsUUID()
  productId: string;

  @Field(() => [ID], {
    description:
      'Attribute IDs that define this variable product (e.g. Color, Size). Order is preserved for SKU generation.',
  })
  @IsArray()
  @ArrayMaxSize(4, { message: 'A product can have at most 4 variant axes' })
  @IsUUID('4', { each: true })
  attributeIds: string[];
}
