import { Field, ID, InputType } from '@nestjs/graphql';
import { OrderStatus } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Seller-side status update on their own SellerOrder.
 *
 * Allowed transitions are validated in the service layer (not just any
 * status → any status). See OrderFlowService.assertValidTransition.
 */
@InputType()
export class UpdateSellerOrderStatusInput {
  @Field(() => ID)
  @IsUUID()
  sellerOrderId: string;

  @Field(() => OrderStatus)
  @IsEnum(OrderStatus)
  status: OrderStatus;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
