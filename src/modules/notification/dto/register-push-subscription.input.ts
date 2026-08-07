import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Input for `registerPushSubscription` — the three fields a browser
 * `PushSubscription` exposes (`endpoint` + `keys.p256dh` + `keys.auth`) plus an
 * optional UA string for device management. Upserted on `endpoint`.
 */
@InputType()
export class RegisterPushSubscriptionInput {
  /** Push-service endpoint URL from `subscription.endpoint`. */
  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  endpoint: string;

  /** Client public key — `subscription.getKey('p256dh')` (base64url). */
  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  p256dh: string;

  /** Client auth secret — `subscription.getKey('auth')` (base64url). */
  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  auth: string;

  /** Optional User-Agent for device management/debug. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  userAgent?: string;
}
