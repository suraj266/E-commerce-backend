import { ObjectType, Field, ID } from '@nestjs/graphql';

@ObjectType()
export class SellerPayoutAccount {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  sellerId: string;

  @Field(() => String)
  accountType: string;

  @Field(() => String)
  accountHolderName: string;

  @Field(() => String, { nullable: true })
  accountNumber?: string | null;

  @Field(() => String, { nullable: true })
  ifscCode?: string | null;

  @Field(() => String, { nullable: true })
  bankName?: string | null;

  @Field(() => String, { nullable: true })
  upiId?: string | null;

  @Field(() => String, { nullable: true })
  walletProvider?: string | null;

  @Field(() => Boolean)
  isPrimary: boolean;

  @Field(() => Boolean)
  isVerified: boolean;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;
}
