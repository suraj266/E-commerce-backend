import { InputType, Field, ID } from '@nestjs/graphql';
import { ProductStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';

@InputType()
export class SetProductStatusInput {
  @Field(() => ID)
  @IsUUID()
  id: string;

  @Field(() => ProductStatus)
  @IsEnum(ProductStatus)
  status: ProductStatus;

  @Field(() => String, { nullable: true, description: 'Reason — recommended for ARCHIVED' })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}
