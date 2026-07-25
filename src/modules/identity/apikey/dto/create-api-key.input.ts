import { Field, InputType } from '@nestjs/graphql';
import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Input for `createApiKey`. The owner is the authenticated caller (taken from
 * the JWT, never from the client), so it is intentionally absent here.
 */
@InputType()
export class CreateApiKeyInput {
  @Field(() => String)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  /** Granted scope slugs (e.g. `orders:read`). May be empty. */
  @Field(() => [String], { defaultValue: [] })
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  @MaxLength(100, { each: true })
  scopes: string[];

  /** Optional hard expiry. Omit for a non-expiring key. */
  @Field(() => Date, { nullable: true })
  @IsOptional()
  expiresAt?: Date;
}
