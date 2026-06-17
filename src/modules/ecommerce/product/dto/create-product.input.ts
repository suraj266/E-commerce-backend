import { InputType, Field, ID, Float } from '@nestjs/graphql';
import { ProductType } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Create a SIMPLE product. Backend creates a single variant under the hood
 * with the supplied price/sku — frontend never sees the variant abstraction
 * for simple products. (Path A pricing model.)
 *
 * Variants for VARIABLE products will land in Phase B with a different DTO.
 */
@InputType()
export class CreateProductInput {
  @Field(() => ID)
  @IsUUID()
  storeId: string;

  // ---- Basics ----

  @Field(() => String)
  @IsString()
  @Length(2, 200)
  name: string;

  @Field(() => String, {
    nullable: true,
    description: 'Auto-generated from name if blank',
  })
  @IsOptional()
  @IsString()
  slug?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  taxId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  shortDescription?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field(() => ProductType, {
    nullable: true,
    defaultValue: ProductType.SIMPLE,
    description:
      'SIMPLE = single SKU (auto-creates 1 variant with the price). VARIABLE = seller adds variants on the next screen.',
  })
  @IsOptional()
  @IsEnum(ProductType)
  productType?: ProductType;

  // ---- Pricing (only for SIMPLE — auto-attached to default variant) ----

  @Field(() => Float, {
    nullable: true,
    description: 'Required for SIMPLE products. Ignored for VARIABLE (set per variant).',
  })
  @ValidateIf(
    (o: { productType?: ProductType }) =>
      !o.productType || o.productType === ProductType.SIMPLE,
  )
  @IsNumber()
  @Min(0)
  price?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  compareAtPrice?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @Field(() => String, {
    nullable: true,
    description: 'SKU. Auto-generated from product name if blank.',
  })
  @IsOptional()
  @IsString()
  @Length(2, 60)
  sku?: string;

  // ---- Logistics ----

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  weight?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  length?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  width?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  height?: number;

  @Field(() => Boolean, { nullable: true, defaultValue: false })
  @IsOptional()
  @IsBoolean()
  isDigital?: boolean;

  // ---- Tax / Compliance ----

  /**
   * Harmonized System of Nomenclature code — required for GST invoicing in
   * India. Accepts 4, 6, or 8 digits (CBIC mandates 6-digit minimum for
   * sellers above ₹5cr turnover; smaller sellers may use 4-digit).
   */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$|^\d{6}$|^\d{8}$/, {
    message: 'HSN code must be 4, 6, or 8 digits',
  })
  hsnCode?: string;

  /**
   * ISO 3166-1 alpha-2 country code (e.g. "IN", "CN"). Required by
   * Consumer Protection (E-Commerce) Rules 2020 — must appear on the PDP
   * and tax invoice. Defaults to "IN" via the migration backfill; sellers
   * can override before publishing.
   */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'countryOfOrigin must be a 2-char ISO 3166-1 alpha-2 code',
  })
  countryOfOrigin?: string;

  /**
   * Tax-inclusive pricing flag. True (default) = stored price is MRP and
   * GST is back-calculated at checkout. False = stored price is exclusive,
   * GST added on top. Sellers can flip per-product for B2B SKUs.
   */
  @Field(() => Boolean, { nullable: true, defaultValue: true })
  @IsOptional()
  @IsBoolean()
  isPriceTaxInclusive?: boolean;

  // ---- SEO ----

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 70)
  seoTitle?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  seoDescription?: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  seoKeywords?: string[];

  // ---- Specifications (JSON-stringified array of groups) ----

  @Field(() => String, {
    nullable: true,
    description: 'JSON: [{name, order, items: [{label, value, order}]}]',
  })
  @IsOptional()
  @IsString()
  specifications?: string;

  // ---- Tags (M:N — connects to existing tags by id) ----

  @Field(() => [ID], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  tagIds?: string[];

  // ---- Labels (M:N — MANUAL labels assigned by id; AUTO labels are derived) ----

  @Field(() => [ID], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  labelIds?: string[];
}
