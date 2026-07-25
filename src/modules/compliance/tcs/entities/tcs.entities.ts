import {
  ObjectType,
  Field,
  ID,
  Int,
  Float,
  registerEnumType,
} from '@nestjs/graphql';
import { TcsLedgerKind, TcsDepositStatus } from '@prisma/client';

registerEnumType(TcsLedgerKind, {
  name: 'TcsLedgerKind',
  description: 'ACCRUAL (+, at supply) or REVERSAL (−, on refund).',
});
registerEnumType(TcsDepositStatus, {
  name: 'TcsDepositStatus',
  description: 'PENDING (rolled up, not yet deposited) or DEPOSITED (filed).',
});

/** One row of the §52 TCS ledger. Amounts are signed (reversal rows negative). */
@ObjectType()
export class TcsLedgerEntity {
  @Field(() => ID)
  id: string;

  @Field(() => TcsLedgerKind)
  kind: TcsLedgerKind;

  /** Reporting period, YYYY-MM. */
  @Field(() => String)
  period: string;

  @Field(() => ID)
  storeId: string;

  @Field(() => ID)
  sellerId: string;

  @Field(() => ID)
  sellerOrderId: string;

  @Field(() => ID, { nullable: true })
  refundId?: string | null;

  @Field(() => Float)
  netTaxableValue: number;

  @Field(() => Float)
  cgstTcs: number;

  @Field(() => Float)
  sgstTcs: number;

  @Field(() => Float)
  igstTcs: number;

  /** Applied total TCS rate in basis points (100 = 1%). */
  @Field(() => Int)
  rateBps: number;

  @Field(() => String)
  taxKind: string;

  @Field(() => Date)
  createdAt: Date;
}

@ObjectType()
export class PaginatedTcsLedger {
  @Field(() => [TcsLedgerEntity])
  items: TcsLedgerEntity[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;

  @Field(() => Int)
  pageSize: number;
}

/** Ledger roll-up for one period (accruals − reversals). */
@ObjectType()
export class TcsPeriodSummary {
  @Field(() => String)
  period: string;

  @Field(() => Float)
  netTaxableValue: number;

  @Field(() => Float)
  cgstTcs: number;

  @Field(() => Float)
  sgstTcs: number;

  @Field(() => Float)
  igstTcs: number;

  @Field(() => Float)
  totalTcs: number;
}

/** A per-period TCS deposit obligation. */
@ObjectType()
export class TcsDepositEntity {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  period: string;

  @Field(() => Float)
  netTaxableValue: number;

  @Field(() => Float)
  cgstTcs: number;

  @Field(() => Float)
  sgstTcs: number;

  @Field(() => Float)
  igstTcs: number;

  @Field(() => Float)
  totalTcs: number;

  @Field(() => TcsDepositStatus)
  status: TcsDepositStatus;

  @Field(() => String, { nullable: true })
  challanRef?: string | null;

  @Field(() => ID, { nullable: true })
  depositedById?: string | null;

  @Field(() => Date, { nullable: true })
  depositedAt?: Date | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}
