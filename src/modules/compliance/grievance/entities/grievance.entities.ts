import {
  ObjectType,
  Field,
  ID,
  Int,
  Float,
  registerEnumType,
} from '@nestjs/graphql';
import {
  GrievanceCategory,
  GrievanceStatus,
  GrievancePriority,
  GrievanceAuthorRole,
} from '@prisma/client';

registerEnumType(GrievanceCategory, {
  name: 'GrievanceCategory',
  description: 'Complaint category (CP-EC redressal).',
});
registerEnumType(GrievanceStatus, {
  name: 'GrievanceStatus',
  description: 'OPEN → IN_PROGRESS → RESOLVED → CLOSED (+ ESCALATED).',
});
registerEnumType(GrievancePriority, {
  name: 'GrievancePriority',
  description: 'Drives the SLA clock (GRIEVANCE_SLA_HOURS).',
});
registerEnumType(GrievanceAuthorRole, {
  name: 'GrievanceAuthorRole',
  description: 'Who authored a thread message: CUSTOMER, OFFICER or SYSTEM.',
});

/** One message on a grievance thread. Internal notes never cross to the customer. */
@ObjectType()
export class GrievanceMessageEntity {
  @Field(() => ID)
  id: string;

  @Field(() => GrievanceAuthorRole)
  authorRole: GrievanceAuthorRole;

  @Field(() => ID, { nullable: true })
  authorUserId?: string | null;

  @Field(() => String)
  body: string;

  /** Officer-only internal note (only ever present on the admin surface). */
  @Field(() => Boolean)
  internal: boolean;

  @Field(() => Date)
  createdAt: Date;
}

/**
 * A single grievance. `slaBreached` is derived (still-open + past `slaDueAt`) so
 * the queue can flag overdue tickets without recomputing on the client.
 */
@ObjectType()
export class GrievanceEntity {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  ticketNumber: string;

  @Field(() => ID, { nullable: true })
  raisedByUserId?: string | null;

  @Field(() => String, { nullable: true })
  contactName?: string | null;

  @Field(() => String, { nullable: true })
  contactEmail?: string | null;

  @Field(() => ID, { nullable: true })
  orderId?: string | null;

  @Field(() => ID, { nullable: true })
  sellerOrderId?: string | null;

  @Field(() => GrievanceCategory)
  category: GrievanceCategory;

  @Field(() => String)
  subject: string;

  @Field(() => String)
  description: string;

  @Field(() => GrievanceStatus)
  status: GrievanceStatus;

  @Field(() => GrievancePriority)
  priority: GrievancePriority;

  @Field(() => Date)
  slaDueAt: Date;

  /** Derived: status is OPEN/IN_PROGRESS and slaDueAt is in the past. */
  @Field(() => Boolean)
  slaBreached: boolean;

  @Field(() => ID, { nullable: true })
  assignedToUserId?: string | null;

  @Field(() => String, { nullable: true })
  resolutionNote?: string | null;

  @Field(() => Date, { nullable: true })
  firstResponseAt?: Date | null;

  @Field(() => Date, { nullable: true })
  escalatedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  resolvedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  closedAt?: Date | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => [GrievanceMessageEntity], { nullable: true })
  messages?: GrievanceMessageEntity[];
}

@ObjectType()
export class PaginatedGrievances {
  @Field(() => [GrievanceEntity])
  items: GrievanceEntity[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;

  @Field(() => Int)
  pageSize: number;
}

/** A `{ key, count }` bucket for the report's category / status breakdowns. */
@ObjectType()
export class GrievanceCountBucket {
  @Field(() => String)
  key: string;

  @Field(() => Int)
  count: number;
}

/**
 * Monthly CP-EC compliance roll-up for one `YYYY-MM` period. PROVISIONAL — the
 * `disclaimer` is embedded so this operational roll-up is never mistaken for a
 * filed statutory return. The Grievance Officer identity is stamped from config
 * (GRIEVANCE_OFFICER_*). // NEEDS LEGAL SIGN-OFF on schema + filing cadence.
 */
@ObjectType()
export class GrievanceComplianceReport {
  @Field(() => String)
  period: string;

  @Field(() => String)
  disclaimer: string;

  /** Grievance Officer name/email/phone from config (GRIEVANCE_OFFICER_*). */
  @Field(() => String, { nullable: true })
  officerName?: string | null;

  @Field(() => String, { nullable: true })
  officerEmail?: string | null;

  @Field(() => String, { nullable: true })
  officerPhone?: string | null;

  /** Carried over unresolved from before the period start. */
  @Field(() => Int)
  openingBacklog: number;

  /** Filed within the period. */
  @Field(() => Int)
  received: number;

  /** Resolved (or closed) within the period. */
  @Field(() => Int)
  resolved: number;

  @Field(() => Int)
  closed: number;

  /** Escalated within the period. */
  @Field(() => Int)
  escalated: number;

  /** Still unresolved at period end (open + in-progress + escalated). */
  @Field(() => Int)
  pending: number;

  /** Resolved within the period whose resolution was past its SLA deadline. */
  @Field(() => Int)
  slaBreached: number;

  /** % of period resolutions that met SLA (0–100), or null when none resolved. */
  @Field(() => Float, { nullable: true })
  slaComplianceRate?: number | null;

  /** Mean resolution time (hours) for grievances resolved in the period. */
  @Field(() => Float, { nullable: true })
  avgResolutionHours?: number | null;

  @Field(() => [GrievanceCountBucket])
  byCategory: GrievanceCountBucket[];

  @Field(() => [GrievanceCountBucket])
  byStatus: GrievanceCountBucket[];
}
