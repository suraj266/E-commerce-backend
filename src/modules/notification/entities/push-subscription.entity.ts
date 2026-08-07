import { ObjectType, Field, ID } from '@nestjs/graphql';

/**
 * PushSubscriptionEntity — one browser Web-Push registration owned by the caller.
 *
 * The client-side keys (`p256dh`/`auth`) are deliberately NOT exposed — they are
 * write-only registration material with no client read use; only the `endpoint`
 * (the client already holds it) + metadata are returned so the UI can list and
 * unregister devices.
 */
@ObjectType('PushSubscription')
export class PushSubscriptionEntity {
  @Field(() => ID)
  id: string;

  /** The push-service endpoint URL (the unregister handle). */
  @Field(() => String)
  endpoint: string;

  /** User-Agent captured at register time, if any. */
  @Field(() => String, { nullable: true })
  userAgent?: string | null;

  @Field(() => Date)
  createdAt: Date;
}
