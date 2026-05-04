import { Field, ID, InputType, Int } from '@nestjs/graphql';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';
import { InventoryMovementType } from '../entities/inventory-movement.entity';

/**
 * Adjust stock for one (variant, warehouse) pair.
 *
 * Two modes:
 *   - delta != null: relative change (+5 received, -1 damaged). Recommended.
 *   - newQuantityOnHand != null: absolute set (recount). Forbidden when delta given.
 *
 * Service computes the effective onHand change and writes a movement row.
 */
@InputType()
export class AdjustInventoryInput {
  @Field(() => ID)
  @IsUUID()
  variantId: string;

  /** Optional — defaults to seller's default warehouse for the variant's store. */
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @Field(() => InventoryMovementType)
  @IsEnum(InventoryMovementType)
  movementType: InventoryMovementType;

  @Field(() => Int, {
    nullable: true,
    description:
      'Relative change to onHand. Positive = received, negative = removed. Mutually exclusive with newQuantityOnHand.',
  })
  @IsOptional()
  @IsInt()
  delta?: number;

  @Field(() => Int, {
    nullable: true,
    description:
      'Absolute set — used for recounts. The service derives delta from current onHand. Mutually exclusive with delta.',
  })
  @IsOptional()
  @IsInt()
  @ValidateIf((o) => o.delta == null)
  newQuantityOnHand?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  notes?: string;
}
