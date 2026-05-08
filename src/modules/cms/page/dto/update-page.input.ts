import { InputType, Field, ID, OmitType, PartialType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';
import { CreatePageInput } from './create-page.input';

/**
 * Partial update — slug can be edited but only if the new slug isn't
 * reserved or in use; service enforces. `isSystem` cannot be flipped after
 * create (admin can't manually mark a user-page as system).
 */
@InputType()
export class UpdatePageInput extends PartialType(
  OmitType(CreatePageInput, ['isSystem'] as const),
) {
  @Field(() => ID)
  @IsUUID()
  id: string;
}
