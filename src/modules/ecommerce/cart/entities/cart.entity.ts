import { ObjectType, Field, ID, Int, Float } from '@nestjs/graphql';
import { Product } from '@/modules/ecommerce/product/entities/product.entity';
import { ProductVariant } from '@/modules/ecommerce/product/entities/product-variant.entity';

@ObjectType()
export class CartItem {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  cartId: string;

  @Field(() => ID)
  productId: string;

  @Field(() => ID)
  variantId: string;

  @Field(() => Int)
  quantity: number;

  @Field(() => Float, {
    description:
      'Price of the variant at the time it was added to the cart. Compare with `unitPriceCurrent` to detect price drift.',
  })
  unitPriceSnapshot: number;

  @Field(() => Float, {
    description: 'Live price right now (variant.price).',
  })
  unitPriceCurrent: number;

  @Field(() => Boolean, {
    description:
      'true when unitPriceCurrent != unitPriceSnapshot — the customer should re-confirm before checkout.',
  })
  priceChanged: boolean;

  @Field(() => Float, {
    description: 'quantity * unitPriceCurrent — what the line costs today.',
  })
  lineTotal: number;

  @Field(() => Int, {
    description:
      'Aggregate available stock across warehouses. -1 if unknown/unbounded.',
  })
  availableQuantity: number;

  @Field(() => String, {
    description: 'Stock state for this variant: IN_STOCK | LOW_STOCK | OUT_OF_STOCK.',
  })
  stockState: string;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => Product, { nullable: true })
  product?: Product | null;

  @Field(() => ProductVariant, { nullable: true })
  variant?: ProductVariant | null;
}

@ObjectType()
export class Cart {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  customerId: string;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => [CartItem])
  items: CartItem[];

  @Field(() => Int, {
    description: 'Sum of quantity across all items — drives the header badge.',
  })
  itemCount: number;

  @Field(() => Float, {
    description: 'Sum of all lineTotal values. Tax + shipping computed at checkout.',
  })
  subtotal: number;

  @Field(() => Boolean, {
    description: 'true if any line has a price change OR is out of stock.',
  })
  needsReview: boolean;
}
