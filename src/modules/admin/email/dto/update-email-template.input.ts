import { InputType, Field } from '@nestjs/graphql';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

@InputType()
export class UpdateEmailTemplateInput {
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
  @MaxLength(255)
  subject?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  htmlBody?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  textBody?: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
