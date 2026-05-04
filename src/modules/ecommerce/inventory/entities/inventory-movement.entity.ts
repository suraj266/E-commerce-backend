import { ObjectType, Field, ID, Int, registerEnumType } from '@nestjs/graphql';

/**
 * Movement types that the system records when stock changes.
 * Manual ones (PURCHASE, ADJUSTMENT, DAMAGE, EXPIRED, TRANSFER) are
 * seller-initiated. SALE / RETURN fire automatically from the order pipeline
 * once that lands in Sprint 2.8.
 */
export enum InventoryMovementType {
  PURCHASE = 'purchase',
  SALE = 'sale',
  RETURN = 'return',
  ADJUSTMENT = 'adjustment',
  TRANSFER = 'transfer',
  DAMAGE = 'damage',
  EXPIRED = 'expired',
}
registerEnumType(InventoryMovementType, { name: 'InventoryMovementType' });

@ObjectType()
export class InventoryMovement {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  inventoryId: string;

  @Field(() => ID)
  variantId: string;

  @Field(() => ID)
  warehouseId: string;

  @Field(() => InventoryMovementType)
  movementType: InventoryMovementType;

  @Field(() => Int)
  quantityChange: number;

  @Field(() => Int)
  quantityBefore: number;

  @Field(() => Int)
  quantityAfter: number;

  @Field(() => String, { nullable: true })
  referenceType?: string | null;

  @Field(() => ID, { nullable: true })
  referenceId?: string | null;

  @Field(() => String, { nullable: true })
  notes?: string | null;

  @Field(() => ID, { nullable: true })
  createdById?: string | null;

  @Field(() => Date)
  createdAt: Date;
}
