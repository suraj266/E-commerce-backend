import { InputType, Field } from '@nestjs/graphql';
import { IsEnum, IsOptional } from 'class-validator';
import { ProductStatus } from '@prisma/client';
import { CreateProductInput } from './create-product.input';

/**
 * Admin-only: create a Product under any store.
 *
 * Inherits every validation rule from CreateProductInput (storeId already
 * required in the parent). Adds an optional `status` field so the admin
 * can publish in one step (seller flow always starts DRAFT).
 */
@InputType()
export class AdminCreateProductInput extends CreateProductInput {
  @Field(() => ProductStatus, {
    nullable: true,
    defaultValue: ProductStatus.DRAFT,
    description: 'Initial product status. DRAFT by default; set ACTIVE to publish immediately.',
  })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}
