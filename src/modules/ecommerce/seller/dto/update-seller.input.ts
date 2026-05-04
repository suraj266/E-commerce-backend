import { InputType, Field, ID, PartialType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';
import { CreateSellerInput } from './create-seller.input';

/**
 * Allows partial update of any seller field. Used by:
 *  - the seller themselves while in DRAFT (self-edit)
 *  - admin while sellers are in REJECTED state (correcting and re-reviewing)
 */
@InputType()
export class UpdateSellerInput extends PartialType(CreateSellerInput) {
  @Field(() => ID)
  @IsUUID()
  id: string;
}
