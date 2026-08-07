import { Field, ID, InputType, Int } from '@nestjs/graphql';
import {
  GrievanceCategory,
  GrievancePriority,
  GrievanceStatus,
} from '@prisma/client';

/**
 * Filters for the admin `adminGrievances` queue. All optional; omitted filters
 * widen the result set. `breachedOnly` narrows to still-open tickets already
 * past their SLA deadline (the escalation worklist).
 */
@InputType()
export class GrievanceFilterInput {
  @Field(() => GrievanceStatus, { nullable: true })
  status?: GrievanceStatus;

  @Field(() => GrievanceCategory, { nullable: true })
  category?: GrievanceCategory;

  @Field(() => GrievancePriority, { nullable: true })
  priority?: GrievancePriority;

  @Field(() => ID, { nullable: true })
  assignedToUserId?: string;

  @Field(() => Boolean, { nullable: true })
  breachedOnly?: boolean;

  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, { nullable: true, defaultValue: 20 })
  pageSize?: number;
}
