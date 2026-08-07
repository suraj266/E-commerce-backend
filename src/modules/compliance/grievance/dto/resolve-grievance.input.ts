import { InputType, Field, ID } from '@nestjs/graphql';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Input for `resolveGrievance` — the officer records the resolution and moves
 * the ticket to RESOLVED. The note is surfaced to the complainant in the
 * resolution email + in-app notification, so it is mandatory + non-trivial.
 */
@InputType()
export class ResolveGrievanceInput {
  @Field(() => ID)
  @IsString()
  grievanceId: string;

  @Field(() => String)
  @IsString()
  @MinLength(5)
  @MaxLength(4000)
  resolutionNote: string;
}
