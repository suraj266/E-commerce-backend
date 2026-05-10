import { InputType, Field } from '@nestjs/graphql';
import { IsEmail, IsOptional, IsString } from 'class-validator';

@InputType()
export class SendTestEmailInput {
  @Field(() => String)
  @IsEmail()
  to: string;

  /** Optional template key to render. When omitted, sends a plain "test" message. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  templateKey?: string;
}
