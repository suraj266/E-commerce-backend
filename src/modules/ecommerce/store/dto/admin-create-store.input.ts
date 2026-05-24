import { InputType, Field, ID } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';
import { CreateStoreInput } from './create-store.input';

/**
 * Admin-only: create a Store under any seller. Extends CreateStoreInput
 * with an explicit sellerId (seller-self version derives it from JWT).
 * Resulting store starts ACTIVE so it can immediately hold products.
 */
@InputType()
export class AdminCreateStoreInput extends CreateStoreInput {
  @Field(() => ID, { description: 'Seller (owner) ID — must exist and be VERIFIED' })
  @IsUUID()
  sellerId: string;
}
