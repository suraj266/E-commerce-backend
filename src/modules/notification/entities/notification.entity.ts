import { ObjectType, Field, ID } from '@nestjs/graphql';

/**
 * NotificationEntity — one row of the in-app notification bell feed (P3-08).
 *
 * `data` is exposed as a JSON STRING (the raw structured context serialised)
 * rather than a GraphQL JSON scalar — the codebase registers no JSON scalar, and
 * a string keeps this self-contained (mirrors the audit/tcs entities). The
 * frontend JSON.parses it client-side to render + deep-link the notification.
 *
 * `read` is a derived boolean (`readAt != null`); the persisted column is the
 * `readAt` timestamp, but the shared GraphQL contract exposes a plain boolean.
 */
@ObjectType('Notification')
export class NotificationEntity {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  type: string;

  @Field(() => String)
  title: string;

  @Field(() => String)
  body: string;

  /** Structured context serialised to a JSON string, or null. */
  @Field(() => String, { nullable: true })
  data?: string | null;

  @Field(() => Boolean)
  read: boolean;

  @Field(() => Date)
  createdAt: Date;
}
