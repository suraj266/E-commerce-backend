import { ObjectType, Field, ID, Float, Int } from '@nestjs/graphql';
import { PayoutStatus } from '@prisma/client';

// PayoutStatus is registered by order.entity.ts (registerEnumType). We reuse it
// here without re-registering to avoid a duplicate-registration error.

/** A single settled seller-order line within a payout run. */
@ObjectType()
export class PayoutItemEntity {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  payoutId: string;

  @Field(() => ID)
  sellerOrderId: string;

  @Field(() => Float)
  amount: number;

  @Field(() => Float)
  refundedAmount: number;

  @Field(() => Date)
  createdAt: Date;
}

/** A settlement run for one seller. */
@ObjectType()
export class PayoutEntity {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  sellerId: string;

  @Field(() => PayoutStatus)
  status: PayoutStatus;

  @Field(() => Float)
  grossAmount: number;

  @Field(() => Float)
  refundAdjustment: number;

  @Field(() => Float)
  netAmount: number;

  @Field(() => String)
  currencyCode: string;

  @Field(() => Date, { nullable: true })
  periodStart?: Date | null;

  @Field(() => Date, { nullable: true })
  periodEnd?: Date | null;

  @Field(() => String, { nullable: true })
  utr?: string | null;

  @Field(() => String, { nullable: true })
  providerRef?: string | null;

  @Field(() => String, { nullable: true })
  failureReason?: string | null;

  @Field(() => String, { nullable: true })
  accountType?: string | null;

  @Field(() => String, { nullable: true })
  accountHolderName?: string | null;

  @Field(() => String, { nullable: true })
  accountNumberMasked?: string | null;

  @Field(() => String, { nullable: true })
  ifscCode?: string | null;

  @Field(() => String, { nullable: true })
  upiId?: string | null;

  @Field(() => Date, { nullable: true })
  paidAt?: Date | null;

  @Field(() => Date, { nullable: true })
  failedAt?: Date | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => [PayoutItemEntity], { nullable: true })
  items?: PayoutItemEntity[];
}

/** A single seller-order line inside a payout preview (nothing persisted). */
@ObjectType()
export class PayoutPreviewItem {
  @Field(() => ID)
  sellerOrderId: string;

  @Field(() => String)
  orderNumber: string;

  @Field(() => Float)
  amount: number;

  @Field(() => Float)
  refundedAmount: number;
}

/** Per-seller aggregate of what a payout run WOULD settle (dry run). */
@ObjectType()
export class PayoutPreview {
  @Field(() => ID)
  sellerId: string;

  @Field(() => String)
  sellerName: string;

  @Field(() => Int)
  itemCount: number;

  @Field(() => Float)
  grossAmount: number;

  @Field(() => Float)
  refundAdjustment: number;

  @Field(() => Float)
  netAmount: number;

  @Field(() => String)
  currencyCode: string;

  @Field(() => [PayoutPreviewItem])
  items: PayoutPreviewItem[];
}

@ObjectType()
export class PaginatedPayouts {
  @Field(() => [PayoutEntity])
  items: PayoutEntity[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;

  @Field(() => Int)
  pageSize: number;
}
