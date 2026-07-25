import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';
import {
  AccountDeletionStatus,
  ConsentPurpose,
  DataExportStatus,
} from '@prisma/client';

registerEnumType(DataExportStatus, { name: 'DataExportStatus' });
registerEnumType(AccountDeletionStatus, { name: 'AccountDeletionStatus' });
registerEnumType(ConsentPurpose, { name: 'ConsentPurpose' });

/**
 * A data-export request. `fileUrl` is a signed, time-limited URL and is only
 * present once the bundle is READY; it is never a permanent link.
 */
@ObjectType()
export class DataExportRequestEntity {
  @Field(() => ID)
  id: string;

  @Field(() => DataExportStatus)
  status: DataExportStatus;

  @Field(() => String, { nullable: true })
  fileUrl?: string | null;

  @Field(() => Date, { nullable: true })
  expiresAt?: Date | null;

  @Field(() => Date)
  requestedAt: Date;

  @Field(() => Date, { nullable: true })
  completedAt?: Date | null;

  @Field(() => Date)
  createdAt: Date;
}

/**
 * An account-deletion (erasure) request. Erasure is fulfilled by irreversible
 * anonymization after the grace window — `executeAfter` is when that runs, and
 * the principal may cancel any time before `anonymizedAt` is set.
 */
@ObjectType()
export class AccountDeletionRequestEntity {
  @Field(() => ID)
  id: string;

  @Field(() => AccountDeletionStatus)
  status: AccountDeletionStatus;

  @Field(() => Date)
  requestedAt: Date;

  @Field(() => Date)
  executeAfter: Date;

  @Field(() => Date, { nullable: true })
  anonymizedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  cancelledAt?: Date | null;
}

/**
 * The current marketing-consent state for the signed-in principal. Derived from
 * the LATEST ConsentRecord for MARKETING_EMAIL, fail-closed (no record =>
 * granted:false).
 */
@ObjectType()
export class MarketingConsentState {
  @Field(() => Boolean)
  granted: boolean;
}
