import { Field, InputType } from '@nestjs/graphql';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

@InputType()
export class SubscribeNewsletterInput {
  @Field(() => String)
  @IsEmail()
  @MaxLength(254)
  email: string;

  /** Where the subscription came from — e.g. "homepage-newsletter". */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  source?: string;
}
