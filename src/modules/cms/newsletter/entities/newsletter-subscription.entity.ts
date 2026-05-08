import {
  ObjectType,
  Field,
  ID,
  Int,
  registerEnumType,
} from '@nestjs/graphql';
import { NewsletterStatus } from '@prisma/client';

registerEnumType(NewsletterStatus, { name: 'NewsletterStatus' });

@ObjectType()
export class NewsletterSubscription {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  email: string;

  @Field(() => String, { nullable: true })
  source?: string | null;

  @Field(() => NewsletterStatus)
  status: NewsletterStatus;

  @Field(() => Date, { nullable: true })
  unsubscribedAt?: Date | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}

@ObjectType()
export class PaginatedNewsletterSubscriptions {
  @Field(() => [NewsletterSubscription])
  items: NewsletterSubscription[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;

  @Field(() => Int)
  pageSize: number;
}

@ObjectType()
export class NewsletterSubscribeResult {
  @Field(() => Boolean)
  ok: boolean;

  @Field(() => String, {
    description:
      'Friendly message — "subscribed", "already-subscribed", "resubscribed".',
  })
  message: string;
}
