import { InputType, Field } from '@nestjs/graphql';
import { IsEnum, IsOptional } from 'class-validator';
import { ProductStatus } from '@prisma/client';
import { UpdateProductInput } from './update-product.input';

/**
 * Admin-only: update any product. Same partial-update shape as
 * UpdateProductInput, with an optional status field so admin can promote /
 * demote in the same call (seller-self uses a separate setStatus mutation
 * because its validation rules differ).
 */
@InputType()
export class AdminUpdateProductInput extends UpdateProductInput {
  @Field(() => ProductStatus, {
    nullable: true,
    description: 'When set, also applies the status change (incl. ARCHIVED, which is admin-only).',
  })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}
