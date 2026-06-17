import { InputType, Field } from '@nestjs/graphql';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Admin edit payload for the tax-invoice template. Mirrors
 * UpdateEmailTemplateInput. `key` is immutable (code references it), so it's
 * not editable here.
 */
@InputType()
export class UpdateInvoiceTemplateInput {
  @Field(() => String)
  @IsString()
  id: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  htmlBody?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  css?: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

/**
 * Preview payload — render arbitrary (unsaved) HBS + CSS against a sample
 * invoice context. Lets the admin editor show a live preview before saving.
 */
@InputType()
export class PreviewInvoiceTemplateInput {
  @Field(() => String)
  @IsString()
  htmlBody: string;

  @Field(() => String)
  @IsString()
  css: string;
}
