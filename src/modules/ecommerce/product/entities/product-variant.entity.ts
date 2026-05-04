import {
  ObjectType,
  Field,
  ID,
  Float,
  Int,
  registerEnumType,
} from '@nestjs/graphql';
import { VariantStatus } from '@prisma/client';
import { ProductAttributeValue } from '@/modules/ecommerce/attribute/entities/product-attribute-value.entity';
import { StockState } from '@/modules/ecommerce/inventory/entities/inventory.entity';

registerEnumType(VariantStatus, { name: 'VariantStatus' });

@ObjectType()
export class ProductVariantAttribute {
  @Field(() => ID)
  attributeId: string;

  @Field(() => ID)
  attributeValueId: string;

  @Field(() => String)
  attributeName: string;

  @Field(() => String)
  attributeSlug: string;

  @Field(() => String)
  value: string;

  @Field(() => String)
  valueSlug: string;
}

@ObjectType()
export class ProductVariant {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  productId: string;

  @Field(() => String)
  sku: string;

  @Field(() => String, { nullable: true })
  name?: string | null;

  @Field(() => Float)
  price: number;

  @Field(() => Float, { nullable: true })
  compareAtPrice?: number | null;

  @Field(() => Float, { nullable: true })
  costPrice?: number | null;

  @Field(() => String, { nullable: true })
  barcode?: string | null;

  @Field(() => Float, { nullable: true })
  weight?: number | null;

  @Field(() => Float, { nullable: true })
  length?: number | null;

  @Field(() => Float, { nullable: true })
  width?: number | null;

  @Field(() => Float, { nullable: true })
  height?: number | null;

  @Field(() => String, { nullable: true })
  imageUrl?: string | null;

  @Field(() => VariantStatus)
  status: VariantStatus;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;

  /** Attribute-value pairs that uniquely define this variant. */
  @Field(() => [ProductVariantAttribute])
  attributes: ProductVariantAttribute[];

  /**
   * Aggregate stock across all warehouses (Phase 1: usually 1 warehouse).
   * Populated by the public product resolver so storefront UIs can gate
   * "Add to Cart" without an extra round trip.
   */
  @Field(() => Int, { nullable: true })
  availableQuantity?: number | null;

  @Field(() => StockState, { nullable: true })
  stockState?: StockState | null;
}

/** Attribute axis chosen for a variable product (lives in product.metadata.variantAxes). */
@ObjectType()
export class VariantAxis {
  @Field(() => ID)
  attributeId: string;

  @Field(() => String)
  attributeName: string;

  @Field(() => String)
  attributeSlug: string;

  @Field(() => [ProductAttributeValue])
  values: ProductAttributeValue[];
}
