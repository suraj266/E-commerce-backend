import { ObjectType, Field, ID } from '@nestjs/graphql';

/**
 * ApiKeyEntity — one programmatic API key, WITHOUT its secret.
 *
 * The plaintext secret and its `keyHash` are NEVER exposed over GraphQL. Only
 * the public `keyPrefix` (safe to display) and lifecycle metadata are returned.
 * The full plaintext is surfaced exactly once, at creation time, via
 * `CreateApiKeyResult.secret`.
 */
@ObjectType()
export class ApiKeyEntity {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  name: string;

  /** Public, non-secret lookup handle (`sk_<16 hex>`). */
  @Field(() => String)
  keyPrefix: string;

  /** Granted scope slugs. */
  @Field(() => [String])
  scopes: string[];

  @Field(() => ID)
  ownerUserId: string;

  @Field(() => Date, { nullable: true })
  lastUsedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  expiresAt?: Date | null;

  @Field(() => Date, { nullable: true })
  revokedAt?: Date | null;

  @Field(() => Date)
  createdAt: Date;
}

/**
 * CreateApiKeyResult — the create mutation's payload. Carries the freshly-minted
 * plaintext `secret` (returned EXACTLY ONCE — it is never persisted and can
 * never be retrieved again) alongside the stored key metadata.
 */
@ObjectType()
export class CreateApiKeyResult {
  /**
   * The full plaintext key (`sk_<prefix>_<secret>`). Shown once in the create
   * dialog; copy it now — it is unrecoverable afterwards.
   */
  @Field(() => String)
  secret: string;

  @Field(() => ApiKeyEntity)
  apiKey: ApiKeyEntity;
}
