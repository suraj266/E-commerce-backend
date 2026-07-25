/**
 * ApiKeyResolver — permission-gated admin surface over programmatic API keys.
 *
 * Reads are gated by `apikey:read`; the create/revoke mutations (which mint or
 * kill a credential) by `apikey:manage`. Both slugs must be seeded in
 * rolePermission.seed.ts (CENTRAL-WIRING TODO) and granted only to trusted
 * roles.
 *
 * The create mutation returns the plaintext secret EXACTLY ONCE
 * (CreateApiKeyResult.secret) — it is never stored and never returned again.
 * The list/revoke surfaces expose only ApiKeyEntity, which omits the hash.
 */

import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { ApiKeyService } from './apikey.service';
import { CreateApiKeyInput } from './dto/create-api-key.input';
import { ApiKeyEntity, CreateApiKeyResult } from './entities/api-key.entity';
import type { ApiKey } from '@prisma/client';

/** Map a Prisma row to the GraphQL entity, dropping the secret hash. */
function toEntity(row: ApiKey): ApiKeyEntity {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: row.scopes,
    ownerUserId: row.ownerUserId,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

@Resolver(() => ApiKeyEntity)
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ApiKeyResolver {
  constructor(private readonly apiKeys: ApiKeyService) {}

  /** Lists API keys, optionally filtered by owner; secret hash never exposed. Auth: apikey:read permission. */
  @Permissions('apikey:read')
  @Query(() => [ApiKeyEntity], { name: 'apiKeys' })
  async apiKeys_(
    @Args('ownerUserId', { type: () => ID, nullable: true })
    ownerUserId?: string,
  ): Promise<ApiKeyEntity[]> {
    const rows = await this.apiKeys.list(ownerUserId ?? null);
    return rows.map(toEntity);
  }

  /** Mints an API key owned by the caller; returns the plaintext secret exactly once. Auth: apikey:manage permission. */
  @Permissions('apikey:manage')
  @Mutation(() => CreateApiKeyResult, { name: 'createApiKey' })
  async createApiKey(
    @Args('input') input: CreateApiKeyInput,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<CreateApiKeyResult> {
    const { secret, apiKey } = await this.apiKeys.create({
      ownerUserId: user.userId,
      name: input.name,
      scopes: input.scopes ?? [],
      expiresAt: input.expiresAt ?? null,
      actorEmail: user.email,
    });
    return { secret, apiKey: toEntity(apiKey) };
  }

  /** Revokes an API key (winner-elect; revoking a missing/already-revoked key 404s). Auth: apikey:manage permission. */
  @Permissions('apikey:manage')
  @Mutation(() => ApiKeyEntity, { name: 'revokeApiKey' })
  async revokeApiKey(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ApiKeyEntity> {
    const row = await this.apiKeys.revoke(id, {
      userId: user.userId,
      email: user.email,
    });
    return toEntity(row);
  }
}
