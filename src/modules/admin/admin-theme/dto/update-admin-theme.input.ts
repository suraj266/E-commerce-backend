import { InputType, Field } from '@nestjs/graphql';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

// Accept any of: oklch(L C H), oklch(L C H / A), with whitespace tolerance.
const OKLCH = /^oklch\(\s*[-+]?[\d.]+(\s+[-+]?[\d.]+){2}(\s*\/\s*[\d.]+%?)?\s*\)$/i;
const REM_OR_PX = /^[\d.]+(rem|px)$/i;
const FONT_FAMILIES = ['inter', 'jetbrains', 'system'] as const;

@InputType()
export class UpdateAdminThemeInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(OKLCH, { message: 'primaryLight must be an OKLCH color' })
  primaryLight?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(OKLCH, { message: 'primaryDark must be an OKLCH color' })
  primaryDark?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(OKLCH, { message: 'accentLight must be an OKLCH color' })
  accentLight?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(OKLCH, { message: 'accentDark must be an OKLCH color' })
  accentDark?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(OKLCH, { message: 'sidebarLight must be an OKLCH color' })
  sidebarLight?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(OKLCH, { message: 'sidebarDark must be an OKLCH color' })
  sidebarDark?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(OKLCH, { message: 'destructiveLight must be an OKLCH color' })
  destructiveLight?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(OKLCH, { message: 'destructiveDark must be an OKLCH color' })
  destructiveDark?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(REM_OR_PX, {
    message: 'radius must be a CSS length like "0.625rem" or "10px"',
  })
  radius?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @IsIn(FONT_FAMILIES, {
    message: `fontFamily must be one of: ${FONT_FAMILIES.join(', ')}`,
  })
  fontFamily?: string;
}
