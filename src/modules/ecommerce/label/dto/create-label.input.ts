import { InputType, Field, Int } from '@nestjs/graphql';
import { LabelType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsHexColor,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Length,
} from 'class-validator';

@InputType()
export class CreateLabelInput {
  /** Stable identifier (lowercase snake/kebab). Immutable after create. */
  @Field(() => String)
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]*$/, {
    message: 'key must be lowercase alphanumeric with - or _',
  })
  @Length(2, 40)
  key: string;

  @Field(() => String)
  @IsString()
  @Length(1, 40)
  name: string;

  /** Hex background colour, e.g. "#ef4444". */
  @Field(() => String)
  @IsHexColor()
  color: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsHexColor()
  textColor?: string;

  /** Optional lucide-react icon name. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  icon?: string;

  @Field(() => LabelType, { defaultValue: LabelType.MANUAL })
  @IsEnum(LabelType)
  type: LabelType;

  /** JSON-encoded RuleSet — required when type=AUTO, ignored for MANUAL. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  rule?: string;

  @Field(() => Int, { nullable: true, defaultValue: 100 })
  @IsOptional()
  @IsInt()
  priority?: number;

  @Field(() => Boolean, { nullable: true, defaultValue: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @Field(() => Int, { nullable: true, defaultValue: 0 })
  @IsOptional()
  @IsInt()
  displayOrder?: number;
}
