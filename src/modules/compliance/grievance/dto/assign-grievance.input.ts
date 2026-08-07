import { InputType, Field, ID } from '@nestjs/graphql';
import { GrievancePriority } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

/**
 * Input for `assignGrievance` — an officer takes / re-assigns a ticket and
 * optionally re-prioritises it. Re-prioritising recomputes the SLA deadline
 * from the new priority (grievance.constants.computeSlaDueAt).
 */
@InputType()
export class AssignGrievanceInput {
  @Field(() => ID)
  @IsString()
  grievanceId: string;

  /** User id of the officer to assign the ticket to. */
  @Field(() => ID)
  @IsString()
  assigneeUserId: string;

  @Field(() => GrievancePriority, { nullable: true })
  @IsOptional()
  @IsEnum(GrievancePriority)
  priority?: GrievancePriority;
}
