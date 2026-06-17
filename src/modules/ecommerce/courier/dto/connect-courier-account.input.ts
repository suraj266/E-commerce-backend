import { Field, InputType, registerEnumType } from '@nestjs/graphql';
import { CourierProvider } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

registerEnumType(CourierProvider, { name: 'CourierProvider' });

/**
 * Connect (or re-connect) a seller's courier account. For Shiprocket the
 * credentials are the API user's email + password; for MOCK any values pass.
 * Stored AES-256-GCM encrypted; never returned by any query.
 */
@InputType()
export class ConnectCourierAccountInput {
  @Field(() => CourierProvider)
  @IsEnum(CourierProvider)
  provider: CourierProvider;

  @Field(() => String)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  email: string;

  @Field(() => String)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password: string;

  /** Static token the courier sends as `x-api-key` on tracking webhooks. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  webhookSecret?: string;

  /** Built from email+password by the service. */
  get credentials(): Record<string, unknown> {
    return { email: this.email, password: this.password };
  }
}
