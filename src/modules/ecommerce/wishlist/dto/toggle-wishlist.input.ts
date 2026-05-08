import { Field, ID, InputType } from '@nestjs/graphql';
import { IsOptional, IsUUID } from 'class-validator';

@InputType()
export class ToggleWishlistInput {
  @Field(() => ID)
  @IsUUID()
  productId: string;

  /** Optional — set when wishlisting a specific variant. */
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  variantId?: string | null;
}
