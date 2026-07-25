import { ObjectType, Field, ID, Int, registerEnumType } from '@nestjs/graphql';
import {
  NewsletterAudience,
  NewsletterCampaignStatus,
} from '@prisma/client';

registerEnumType(NewsletterAudience, { name: 'NewsletterAudience' });
registerEnumType(NewsletterCampaignStatus, {
  name: 'NewsletterCampaignStatus',
});

/**
 * A consent-gated broadcast campaign (P3 Wave 4). `htmlBody` is the admin-authored
 * body; the send-time wrapper adds header/footer + unsubscribe link. Counts are
 * finalized when the durable fan-out completes.
 */
@ObjectType()
export class NewsletterCampaign {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  subject: string;

  @Field(() => String)
  htmlBody: string;

  @Field(() => NewsletterAudience)
  audience: NewsletterAudience;

  @Field(() => NewsletterCampaignStatus)
  status: NewsletterCampaignStatus;

  @Field(() => Int, {
    description: 'Total ACTIVE addresses considered by the fan-out.',
  })
  recipientCount: number;

  @Field(() => Int, {
    description: 'Recipients kept + enqueued/delivered (passed the consent gate).',
  })
  sentCount: number;

  @Field(() => Int, {
    description: 'Recipients dropped by the consent gate or a mid-flight unsubscribe.',
  })
  skippedCount: number;

  @Field(() => Date, { nullable: true })
  sendStartedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  sentAt?: Date | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}

@ObjectType()
export class PaginatedNewsletterCampaigns {
  @Field(() => [NewsletterCampaign])
  items: NewsletterCampaign[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;

  @Field(() => Int)
  pageSize: number;
}
