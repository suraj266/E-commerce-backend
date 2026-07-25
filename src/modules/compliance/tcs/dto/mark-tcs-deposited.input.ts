import { Field, InputType } from '@nestjs/graphql';

/**
 * Input for `markTcsDeposited` — an admin records that the CA has filed GSTR-8
 * and paid the challan for a period. `challanRef` is the government
 * challan / CIN reference (mandatory audit trail for the deposit).
 */
@InputType()
export class MarkTcsDepositedInput {
  /** Reporting period, `YYYY-MM`. */
  @Field(() => String)
  period: string;

  /** Government challan / CIN reference for the deposit. */
  @Field(() => String)
  challanRef: string;
}
