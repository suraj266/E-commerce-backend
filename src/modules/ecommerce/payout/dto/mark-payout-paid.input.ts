import { InputType, Field, ID } from '@nestjs/graphql';

/**
 * MarkPayoutPaidInput — the launch-minimum manual disbursement path. Finance
 * transfers via bank/UPI outside the platform and pastes the resulting UTR
 * (and optional provider reference) here to close the payout.
 */
@InputType()
export class MarkPayoutPaidInput {
  @Field(() => ID)
  payoutId: string;

  @Field(() => String)
  utr: string;

  @Field(() => String, { nullable: true })
  providerRef?: string;
}
