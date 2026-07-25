import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

/**
 * AuditLogEntity — one row of the append-only audit trail.
 *
 * `before` / `after` are exposed as JSON STRINGS (the raw snapshot serialised)
 * rather than a GraphQL JSON scalar: the codebase registers no JSON scalar, and
 * a string keeps this self-contained (no new dependency, no cross-module scalar
 * registration to collide with parallel workstreams). The admin diff viewer
 * (P3-06) JSON.parses these client-side.
 */
@ObjectType()
export class AuditLogEntity {
  @Field(() => ID)
  id: string;

  @Field(() => ID, { nullable: true })
  actorUserId?: string | null;

  @Field(() => String, { nullable: true })
  actorEmail?: string | null;

  @Field(() => String)
  action: string;

  @Field(() => String)
  entityType: string;

  @Field(() => ID, { nullable: true })
  entityId?: string | null;

  /** JSON snapshot before the action, serialised (secrets redacted). */
  @Field(() => String, { nullable: true })
  before?: string | null;

  /** JSON snapshot after the action, serialised (secrets redacted). */
  @Field(() => String, { nullable: true })
  after?: string | null;

  @Field(() => String, { nullable: true })
  ip?: string | null;

  @Field(() => String, { nullable: true })
  userAgent?: string | null;

  @Field(() => String, { nullable: true })
  requestId?: string | null;

  @Field(() => Date)
  createdAt: Date;
}

@ObjectType()
export class PaginatedAuditLogs {
  @Field(() => [AuditLogEntity])
  items: AuditLogEntity[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;

  @Field(() => Int)
  pageSize: number;
}
