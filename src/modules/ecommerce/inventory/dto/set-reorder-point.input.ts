import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

@InputType()
export class SetReorderPointInput {
  @Field(() => ID)
  @IsUUID()
  variantId: string;

  /** Defaults to the variant's store's default warehouse if omitted. */
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @Field(() => Int)
  @IsInt()
  @Min(0)
  reorderPoint: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  reorderQuantity?: number;
}
