import { ObjectType, Field, ID, Float } from '@nestjs/graphql';
import { BusinessType, SellerStatus } from '@prisma/client';
import { SellerPayoutAccount } from './seller-payout-account.entity';

@ObjectType()
export class Seller {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  userId: string;

  @Field(() => String)
  legalName: string;

  @Field(() => String)
  displayName: string;

  @Field(() => BusinessType)
  businessType: BusinessType;

  @Field(() => Date, { nullable: true })
  dateOfIncorporation?: Date | null;

  @Field(() => String, { nullable: true })
  registrationNumber?: string | null;

  @Field(() => String)
  panNumber: string;

  @Field(() => String, { nullable: true })
  gstin?: string | null;

  @Field(() => String)
  businessEmail: string;

  @Field(() => String)
  businessPhone: string;

  @Field(() => String, { nullable: true })
  supportEmail?: string | null;

  @Field(() => String, { nullable: true })
  signatoryName?: string | null;

  @Field(() => String, { nullable: true })
  signatoryPan?: string | null;

  @Field(() => String, { nullable: true })
  signatoryDesignation?: string | null;

  @Field(() => SellerStatus)
  overallStatus: SellerStatus;

  @Field(() => Date, { nullable: true })
  panVerifiedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  gstinVerifiedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  bankVerifiedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  documentsVerifiedAt?: Date | null;

  @Field(() => String, { nullable: true })
  rejectionReason?: string | null;

  @Field(() => Float)
  commissionRate: number;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;

  @Field(() => [SellerPayoutAccount], { nullable: true })
  payoutAccounts?: SellerPayoutAccount[];
}
