import { InputType, Field, Int } from '@nestjs/graphql';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  EmailEncryption,
  EmailMailer,
} from '../entities/email-setting.entity';

@InputType()
export class UpdateEmailSettingInput {
  @Field(() => EmailMailer, { nullable: true })
  @IsOptional()
  @IsEnum(EmailMailer)
  mailer?: EmailMailer;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  host?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string;

  /**
   * Plaintext password — encrypted on save. Pass only when changing it;
   * omit (or pass empty string) to keep the existing password.
   */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  password?: string;

  @Field(() => EmailEncryption, { nullable: true })
  @IsOptional()
  @IsEnum(EmailEncryption)
  encryption?: EmailEncryption;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  senderName?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsEmail()
  senderEmail?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  localDomain?: string;
}
