import { InputType, Field, ID, Float } from '@nestjs/graphql';
import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * CreateSellerRefundInput — seller-initiated refund on their OWN cancelled
 * sub-order.
 *
 * Unlike `RequestRefundInput` (customer-initiated, lands as REQUESTED for an
 * admin to approve) this one executes: the service creates the Refund and
 * immediately drives the guarded `approveRefund` money path.
 *
 * `amount` is optional — omitted means "the full refundable amount for this
 * slice" (what the seller UI pre-fills). A seller may lower it for a partial
 * refund; the service caps it at their own slice's refundable ceiling.
 *
 * There is no `restock` flag on purpose: the cancellation already returned this
 * slice's stock, so the refund must never restock again (see the service).
 *
 * The validators are REQUIRED, not decoration — the global ValidationPipe runs
 * with `whitelist: true, forbidNonWhitelisted: true`, so an undecorated field
 * is stripped and the request is rejected before it reaches the resolver.
 */
@InputType()
export class CreateSellerRefundInput {
  @Field(() => ID)
  @IsUUID()
  sellerOrderId: string;

  /**
   * Two decimal places — money is Decimal(10,2) and the gateway is called in
   * paise. The real ceiling is enforced server-side against the seller's slice.
   */
  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
