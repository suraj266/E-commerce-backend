import {
  ObjectType,
  Field,
  ID,
  Float,
  registerEnumType,
} from '@nestjs/graphql';
import { ProductStatus, ProductType } from '@prisma/client';
import { Brand } from '@/modules/ecommerce/brand/entities/brand.entity';
import { Tag } from '@/modules/ecommerce/tag/entities/tag.entity';
import { Category } from '@/modules/ecommerce/category/entities/category.entity';
import { Tax } from '@/modules/ecommerce/tax/entities/tax.entity';
import { ProductImage } from './product-image.entity';
import { ProductVariant } from './product-variant.entity';

registerEnumType(ProductStatus, { name: 'ProductStatus' });
registerEnumType(ProductType, { name: 'ProductType' });

@ObjectType()
export class Product {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  storeId: string;

  @Field(() => ID, { nullable: true })
  categoryId?: string | null;

  @Field(() => ID, { nullable: true })
  brandId?: string | null;

  @Field(() => ID, { nullable: true })
  taxId?: string | null;

  @Field(() => String)
  name: string;

  @Field(() => String)
  slug: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => String, { nullable: true })
  shortDescription?: string | null;

  @Field(() => ProductType)
  productType: ProductType;

  @Field(() => ProductStatus)
  status: ProductStatus;

  @Field(() => Boolean)
  isFeatured: boolean;

  @Field(() => Boolean)
  isDigital: boolean;

  // ---- Pricing (computed from default variant for SIMPLE products) ----

  @Field(() => Float, {
    nullable: true,
    description: 'Default variant price (SIMPLE products) or starting from (VARIABLE).',
  })
  price?: number | null;

  @Field(() => Float, { nullable: true })
  compareAtPrice?: number | null;

  @Field(() => Float, { nullable: true })
  costPrice?: number | null;

  @Field(() => String, { nullable: true })
  sku?: string | null;

  // ---- Logistics ----

  @Field(() => Float, { nullable: true })
  weight?: number | null;

  @Field(() => Float, { nullable: true })
  length?: number | null;

  @Field(() => Float, { nullable: true })
  width?: number | null;

  @Field(() => Float, { nullable: true })
  height?: number | null;

  // ---- Tax / Compliance ----

  @Field(() => String, {
    nullable: true,
    description:
      'Harmonized System of Nomenclature code (4/6/8 digits). Required for GST invoicing in India.',
  })
  hsnCode?: string | null;

  // ---- SEO ----

  @Field(() => String, { nullable: true })
  seoTitle?: string | null;

  @Field(() => String, { nullable: true })
  seoDescription?: string | null;

  @Field(() => [String])
  seoKeywords: string[];

  // ---- Specifications (JSON-stringified array of groups) ----

  @Field(() => String, {
    description:
      'JSON-encoded array: [{name, order, items: [{label, value, order}]}]. Frontend parses.',
  })
  specifications: string;

  // ---- Timestamps ----

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;

  // ---- Relations ----

  @Field(() => [ProductImage], { nullable: true })
  images?: ProductImage[];

  @Field(() => Brand, { nullable: true })
  brand?: Brand | null;

  @Field(() => Category, { nullable: true })
  category?: Category | null;

  @Field(() => Tax, { nullable: true })
  tax?: Tax | null;

  @Field(() => [Tag], { nullable: true })
  tags?: Tag[];

  @Field(() => [ProductVariant], { nullable: true, description: 'Always present; for SIMPLE products contains 1 default variant.' })
  variants?: ProductVariant[];
}
