import { Field, ID, InputType, Int } from '@nestjs/graphql';

/**
 * Filters for the admin `auditLogs` query. All optional; omitted filters widen
 * the result set. `from`/`to` bound `createdAt` (inclusive lower, exclusive
 * upper is applied in the service).
 */
@InputType()
export class AuditLogFilterInput {
  @Field(() => ID, { nullable: true })
  actorUserId?: string;

  @Field(() => String, { nullable: true })
  entityType?: string;

  @Field(() => ID, { nullable: true })
  entityId?: string;

  @Field(() => String, { nullable: true })
  action?: string;

  @Field(() => Date, { nullable: true })
  from?: Date;

  @Field(() => Date, { nullable: true })
  to?: Date;

  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, { nullable: true, defaultValue: 20 })
  pageSize?: number;
}
