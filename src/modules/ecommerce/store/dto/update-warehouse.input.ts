import { InputType, Field, ID, OmitType, PartialType } from '@nestjs/graphql';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { CreateWarehouseInput } from './create-warehouse.input';

@InputType()
export class UpdateWarehouseInput extends PartialType(
  OmitType(CreateWarehouseInput, ['storeId'] as const),
) {
  @Field(() => ID)
  @IsUUID()
  id: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
