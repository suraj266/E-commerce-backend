import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';
import { Seller } from './seller.entity';

/**
 * Funnel status of a seller-role user. Goes beyond SellerStatus to also cover
 * users who have registered but not yet started onboarding.
 */
export enum SellerListStatus {
  REGISTERED_UNVERIFIED = 'REGISTERED_UNVERIFIED', // User row exists, emailVerifiedAt = null
  REGISTERED = 'REGISTERED',                         // Email verified, no Seller record yet
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  UNDER_REVIEW = 'UNDER_REVIEW',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
  SUSPENDED = 'SUSPENDED',
}
registerEnumType(SellerListStatus, { name: 'SellerListStatus' });

@ObjectType()
export class SellerListItem {
  @Field(() => ID)
  userId: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  email: string;

  @Field(() => String)
  phone: string;

  @Field(() => Date, { nullable: true })
  emailVerifiedAt?: Date | null;

  @Field(() => Date)
  registeredAt: Date;

  @Field(() => SellerListStatus)
  status: SellerListStatus;

  @Field(() => Seller, { nullable: true })
  seller?: Seller | null;
}
