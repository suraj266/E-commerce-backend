import { InputType, Field, ID, OmitType, PartialType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';
import { CreateProductInput } from './create-product.input';

/**
 * Partial update — storeId can't change once product is created.
 */
@InputType()
export class UpdateProductInput extends PartialType(
  OmitType(CreateProductInput, ['storeId'] as const),
) {
  @Field(() => ID)
  @IsUUID()
  id: string;
}
