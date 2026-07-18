import { ObjectType, Field, ID, Float, Int, registerEnumType } from '@nestjs/graphql';
import { RefundStatus } from '@prisma/client';

registerEnumType(RefundStatus, { name: 'RefundStatus' });

/**
 * Refund — a single buyer-refund attempt against a captured Payment.
 * `credentials`/raw gateway payloads are never exposed; only the safe
 * ledger fields cross the GraphQL boundary.
 */
@ObjectType()
export class RefundEntity {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  orderId: string;

  @Field(() => ID, { nullable: true })
  sellerOrderId?: string | null;

  @Field(() => ID)
  paymentId: string;

  @Field(() => Float)
  amount: number;

  @Field(() => String, { nullable: true })
  reason?: string | null;

  @Field(() => RefundStatus)
  status: RefundStatus;

  @Field(() => Boolean)
  restock: boolean;

  @Field(() => String, { nullable: true })
  gatewayRefundId?: string | null;

  @Field(() => ID, { nullable: true })
  requestedById?: string | null;

  @Field(() => ID, { nullable: true })
  approvedById?: string | null;

  @Field(() => String, { nullable: true })
  failureReason?: string | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}

@ObjectType()
export class PaginatedRefunds {
  @Field(() => [RefundEntity])
  items: RefundEntity[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;

  @Field(() => Int)
  pageSize: number;
}
