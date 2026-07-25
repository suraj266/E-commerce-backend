import {
  ObjectType,
  Field,
  ID,
  Float,
  Int,
  registerEnumType,
} from '@nestjs/graphql';
import { ReturnStatus, ReturnResolutionType } from '@prisma/client';

registerEnumType(ReturnStatus, { name: 'ReturnStatus' });
registerEnumType(ReturnResolutionType, { name: 'ReturnResolutionType' });

@ObjectType()
export class ReturnItemEntity {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  orderItemId: string;

  @Field(() => Int)
  quantity: number;

  @Field(() => String, { nullable: true })
  condition?: string | null;
}

@ObjectType()
export class ReturnEventEntity {
  @Field(() => ID)
  id: string;

  @Field(() => ReturnStatus, { nullable: true })
  fromStatus?: ReturnStatus | null;

  @Field(() => ReturnStatus)
  toStatus: ReturnStatus;

  @Field(() => String, { nullable: true })
  note?: string | null;

  @Field(() => Date)
  createdAt: Date;
}

/**
 * Linked-refund summary for a return (admin oversight only). Surfaces just what
 * the admin needs to decide whether to disburse a manual (COD) return refund:
 * the refund's terminal status, amount, whether it's a manual/COD refund with no
 * gateway rail, and — when disbursed — the recorded UTR/reference. `status` is a
 * plain String (not the RefundStatus enum) to avoid a second registration of the
 * enum from this module (same convention audit/tcs use for JSON-ish fields).
 */
@ObjectType()
export class ManualRefundInfo {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  status: string;

  @Field(() => Float)
  amount: number;

  /** COD / no-gateway refund that finance must disburse by hand (UTR). */
  @Field(() => Boolean)
  isManual: boolean;

  /** True when isManual AND still REQUESTED → the "Mark disbursed" action shows. */
  @Field(() => Boolean)
  disbursable: boolean;

  /** UTR / bank reference recorded at manual disbursement, if any. */
  @Field(() => String, { nullable: true })
  reference?: string | null;
}

/**
 * ReturnRequest — a single customer return against one delivered SellerOrder.
 * Only safe ledger/lifecycle fields cross the GraphQL boundary.
 */
@ObjectType()
export class ReturnRequestEntity {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  returnNumber: string;

  @Field(() => ID)
  orderId: string;

  @Field(() => ID)
  sellerOrderId: string;

  @Field(() => ID)
  sellerId: string;

  @Field(() => ID)
  customerId: string;

  @Field(() => ReturnStatus)
  status: ReturnStatus;

  @Field(() => ReturnResolutionType)
  resolutionType: ReturnResolutionType;

  @Field(() => String)
  reason: string;

  @Field(() => String, { nullable: true })
  customerNote?: string | null;

  @Field(() => String, { nullable: true })
  qcNote?: string | null;

  @Field(() => String, { nullable: true })
  rejectionReason?: string | null;

  @Field(() => String, { nullable: true })
  reverseAwb?: string | null;

  @Field(() => String, { nullable: true })
  reverseLabelUrl?: string | null;

  @Field(() => ID, { nullable: true })
  refundId?: string | null;

  @Field(() => Float, { nullable: true })
  refundAmount?: number | null;

  // ---- Replacement arm (populated only for resolutionType=REPLACEMENT) ----

  @Field(() => String, { nullable: true })
  replacementReference?: string | null;

  @Field(() => Date, { nullable: true })
  replacementApprovedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  replacementShippedAt?: Date | null;

  /**
   * Linked-refund summary, attached ONLY by the admin detail read
   * (adminReturnDetail) so finance can disburse a manual COD refund. Null on the
   * customer/seller surfaces.
   */
  @Field(() => ManualRefundInfo, { nullable: true })
  manualRefund?: ManualRefundInfo | null;

  @Field(() => Date)
  requestedAt: Date;

  @Field(() => Date, { nullable: true })
  approvedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  receivedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  refundedAt?: Date | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => [ReturnItemEntity], { nullable: true })
  items?: ReturnItemEntity[];

  @Field(() => [ReturnEventEntity], { nullable: true })
  events?: ReturnEventEntity[];
}

@ObjectType()
export class PaginatedReturns {
  @Field(() => [ReturnRequestEntity])
  items: ReturnRequestEntity[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;

  @Field(() => Int)
  pageSize: number;
}
