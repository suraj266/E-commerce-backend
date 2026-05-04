import { InputType, Field, ID } from '@nestjs/graphql';
import {
  IsUUID,
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
  Length,
} from 'class-validator';

export const PAYOUT_ACCOUNT_TYPES = ['bank', 'upi', 'wallet'] as const;
export type PayoutAccountType = (typeof PAYOUT_ACCOUNT_TYPES)[number];

@InputType()
export class CreatePayoutAccountInput {
  @Field(() => ID)
  @IsUUID()
  sellerId: string;

  @Field(() => String, {
    description: `One of: ${PAYOUT_ACCOUNT_TYPES.join(', ')}`,
  })
  @IsIn(PAYOUT_ACCOUNT_TYPES as unknown as string[])
  accountType: PayoutAccountType;

  @Field(() => String)
  @IsString()
  @Length(2, 200)
  accountHolderName: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  accountNumber?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  ifscCode?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  bankName?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  upiId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  walletProvider?: string;

  @Field(() => Boolean, { nullable: true, defaultValue: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
