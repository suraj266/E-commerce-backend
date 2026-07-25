import { ObjectType, Field, ID, Int, Float } from '@nestjs/graphql';

/**
 * Machine-readable reason a cart line needs the customer's attention.
 * Advisory only — `validateCart` NEVER mutates the cart or throws. The
 * Phase-1 authoritative oversell guard still runs at order placement.
 */
export const CART_WARNING_CODES = [
  'OUT_OF_STOCK', // available <= 0
  'REDUCED_QUANTITY', // 0 < available < requested quantity
  'PRICE_CHANGED', // live price != snapshot price
  'UNAVAILABLE', // product/variant delisted, deleted, or not ACTIVE
] as const;

export type CartWarningCode = (typeof CART_WARNING_CODES)[number];

@ObjectType()
export class CartWarning {
  @Field(() => ID, { description: 'Variant the warning is about.' })
  variantId: string;

  @Field(() => String, {
    description:
      'OUT_OF_STOCK | REDUCED_QUANTITY | PRICE_CHANGED | UNAVAILABLE.',
  })
  code: CartWarningCode;

  @Field(() => String, {
    description: 'Human-readable, display-ready explanation.',
  })
  message: string;

  @Field(() => Int, {
    nullable: true,
    description: 'Live available stock across warehouses (stock-related codes).',
  })
  availableQuantity?: number | null;

  @Field(() => Int, {
    nullable: true,
    description:
      'Quantity the customer could keep instead (= availableQuantity for REDUCED_QUANTITY).',
  })
  suggestedQuantity?: number | null;

  @Field(() => Float, {
    nullable: true,
    description: 'Snapshot price at add time (PRICE_CHANGED only).',
  })
  oldPrice?: number | null;

  @Field(() => Float, {
    nullable: true,
    description: 'Current live price (PRICE_CHANGED only).',
  })
  newPrice?: number | null;
}

@ObjectType()
export class CartValidationResult {
  @Field(() => Boolean, {
    description: 'true when there are zero warnings — safe to proceed.',
  })
  valid: boolean;

  @Field(() => [CartWarning], {
    description: 'One entry per (variant, issue). Empty when valid.',
  })
  warnings: CartWarning[];
}
