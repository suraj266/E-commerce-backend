import { Field, ID, Int, InputType } from '@nestjs/graphql';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

@InputType()
export class UpdateCartItemQtyInput {
  @Field(() => ID)
  @IsUUID()
  variantId: string;

  /** Absolute new quantity. 0 removes the item. */
  @Field(() => Int)
  @IsInt()
  @Min(0)
  @Max(99)
  quantity: number;
}
