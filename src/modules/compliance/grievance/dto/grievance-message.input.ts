import { InputType, Field, ID } from '@nestjs/graphql';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * A reply on a grievance thread. Used by both the customer (`replyToGrievance`)
 * and the officer (`respondToGrievance`). `internal` is honoured ONLY on the
 * officer surface — an internal note stays officer-only and never notifies /
 * emails the complainant.
 */
@InputType()
export class GrievanceMessageInput {
  @Field(() => ID)
  @IsString()
  grievanceId: string;

  @Field(() => String)
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  internal?: boolean;
}
