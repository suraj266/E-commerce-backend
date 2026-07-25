import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { TcsLedgerKind } from '@prisma/client';

/**
 * Filters for the admin `tcsLedger` query. All optional; omitted filters widen
 * the result set. `period` is `YYYY-MM`.
 */
@InputType()
export class TcsLedgerFilterInput {
  @Field(() => String, { nullable: true })
  period?: string;

  @Field(() => ID, { nullable: true })
  sellerId?: string;

  @Field(() => TcsLedgerKind, { nullable: true })
  kind?: TcsLedgerKind;

  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, { nullable: true, defaultValue: 20 })
  pageSize?: number;
}
