import { InputType, Field } from '@nestjs/graphql';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

/**
 * Slug rules: lowercase letters, digits, hyphens. No leading/trailing
 * hyphen. 2-60 chars. Reserved-slug check happens in the service against
 * `RESERVED_SLUGS` (admin / seller / api / product / category / brand /
 * etc. — see service file).
 */
@InputType()
export class CreatePageInput {
  @Field(() => String)
  @IsString()
  @Length(2, 60)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'Slug must be lowercase letters/digits separated by single hyphens',
  })
  slug: string;

  @Field(() => String)
  @IsString()
  @Length(2, 120)
  title: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 70)
  metaTitle?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  metaDesc?: string;

  @Field(() => String, {
    nullable: true,
    description:
      'JSON-encoded blocks array. Optional on create; defaults to "[]".',
  })
  @IsOptional()
  @IsString()
  blocks?: string;

  @Field(() => Boolean, { nullable: true, defaultValue: false })
  @IsOptional()
  @IsBoolean()
  isSystem?: boolean;
}
