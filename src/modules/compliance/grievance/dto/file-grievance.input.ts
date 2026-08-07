import { InputType, Field, ID } from '@nestjs/graphql';
import { GrievanceCategory } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Input for `fileGrievance` — a logged-in customer opens a complaint. The
 * complainant identity comes from the JWT (raisedByUserId), never the payload.
 * `contactEmail` is an optional override for where the acknowledgement is sent
 * (defaults to the account email); order context is optional.
 */
@InputType()
export class FileGrievanceInput {
  @Field(() => GrievanceCategory)
  @IsEnum(GrievanceCategory)
  category: GrievanceCategory;

  @Field(() => String)
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  subject: string;

  @Field(() => String)
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  description: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  orderId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  sellerOrderId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  contactEmail?: string;
}
