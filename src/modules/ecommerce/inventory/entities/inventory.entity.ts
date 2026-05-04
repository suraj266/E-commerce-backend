import { ObjectType, Field, ID, Int, registerEnumType } from '@nestjs/graphql';
import { ProductVariant } from '@/modules/ecommerce/product/entities/product-variant.entity';
import { Warehouse } from '@/modules/ecommerce/store/entities/warehouse.entity';
import { Product } from '@/modules/ecommerce/product/entities/product.entity';

/**
 * Derived stock state — purely computed from quantityAvailable + reorderPoint.
 * Lives in code (not DB) so we don't need denormalised triggers.
 */
export enum StockState {
  IN_STOCK = 'IN_STOCK',
  LOW_STOCK = 'LOW_STOCK',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
}
registerEnumType(StockState, { name: 'StockState' });

@ObjectType()
export class Inventory {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  variantId: string;

  @Field(() => ID)
  warehouseId: string;

  @Field(() => Int)
  quantityAvailable: number;

  @Field(() => Int)
  quantityReserved: number;

  @Field(() => Int)
  quantityOnHand: number;

  @Field(() => Int)
  reorderPoint: number;

  @Field(() => Int)
  reorderQuantity: number;

  @Field(() => Date, { nullable: true })
  lastCountedAt?: Date | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  // ---- Computed ----

  @Field(() => StockState, {
    description:
      'Derived: OUT_OF_STOCK when available <= 0; LOW_STOCK when available <= reorderPoint; else IN_STOCK.',
  })
  stockState: StockState;

  // ---- Relations ----

  @Field(() => ProductVariant, { nullable: true })
  variant?: ProductVariant | null;

  @Field(() => Warehouse, { nullable: true })
  warehouse?: Warehouse | null;

  @Field(() => Product, {
    nullable: true,
    description:
      "The variant's parent product — included for cross-product dashboard listings so the UI doesn't have to chase nested relations.",
  })
  product?: Product | null;
}
