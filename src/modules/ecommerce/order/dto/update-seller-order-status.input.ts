import { Field, ID, InputType } from '@nestjs/graphql';
import { OrderStatus } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
} from 'class-validator';

/**
 * Seller-side status update on their own SellerOrder.
 *
 * Allowed transitions are validated in the service layer (not just any
 * status → any status). See OrderFlowService.assertValidTransition.
 *
 * The tracking fields are only meaningful when `status === SHIPPED` (in-house
 * v1: the seller types them in). They're stamped onto the SellerOrder and
 * flow into the "order shipped" email + customer order page.
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

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  trackingNumber?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  carrier?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'trackingUrl must be a valid URL' })
  @MaxLength(500)
  trackingUrl?: string;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  expectedDeliveryAt?: Date;
}
