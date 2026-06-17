import { InputType, Field, ID, Int } from '@nestjs/graphql';
import { LabelType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsHexColor,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

/**
 * Partial label update. `key` is immutable (code/seeds reference it), so it's
 * not editable here.
 */
@InputType()
export class UpdateLabelInput {
  @Field(() => ID)
  @IsUUID()
  id: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  name?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsHexColor()
  color?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsHexColor()
  textColor?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  icon?: string;

  @Field(() => LabelType, { nullable: true })
  @IsOptional()
  @IsEnum(LabelType)
  type?: LabelType;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  rule?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  priority?: number;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  displayOrder?: number;
}
