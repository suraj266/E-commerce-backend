import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { CourierAccountStatus, CourierProvider } from '@prisma/client';

registerEnumType(CourierAccountStatus, { name: 'CourierAccountStatus' });

/**
 * Masked courier-account view (mirrors PaymentConfig.toSafeShape). Credentials
 * + token are NEVER exposed — only whether they exist + the connection status.
 */
@ObjectType()
export class CourierAccountSafe {
  @Field(() => ID)
  id: string;

  @Field(() => CourierProvider)
  provider: CourierProvider;

  @Field(() => CourierAccountStatus)
  status: CourierAccountStatus;

  @Field(() => Boolean)
  isEnabled: boolean;

  @Field(() => Boolean)
  hasCredentials: boolean;

  @Field(() => String, { nullable: true })
  pickupLocationNickname?: string | null;

  @Field(() => Boolean)
  webhookConfigured: boolean;

  @Field(() => String, { nullable: true })
  lastError?: string | null;

  @Field(() => Date, { nullable: true })
  lastTestedAt?: Date | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}
