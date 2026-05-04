import { InputType, Field, ID, OmitType, PartialType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';
import { CreatePayoutAccountInput } from './create-payout-account.input';

@InputType()
export class UpdatePayoutAccountInput extends PartialType(
  OmitType(CreatePayoutAccountInput, ['sellerId'] as const),
) {
  @Field(() => ID)
  @IsUUID()
  id: string;
}
