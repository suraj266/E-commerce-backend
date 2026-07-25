/**
 * ApiKeyModule — programmatic API keys for sellers/admins (Phase 3, Wave 4).
 *
 * Provides:
 *   - ApiKeyService: mint (returns the plaintext once) / list / revoke / verify.
 *   - ApiKeyResolver: perm-gated admin surface (apikey:read / apikey:manage).
 *   - ApiKeyGuard: authenticates an inbound `Authorization: Bearer sk_...`. NOT
 *     retrofitted onto existing endpoints this wave — attach it (with
 *     `@UseGuards(ApiKeyGuard)`) to any future machine-to-machine surface, e.g.
 *     a public REST/GraphQL API for sellers, the courier/webhook ingress, or a
 *     bulk product/inventory import endpoint. Both the service and the guard are
 *     exported so those consumers can inject them.
 *
 * Its dependencies are all @Global (PrismaService, AuditService), so no
 * `imports` are needed. Registered once in AppModule.
 */

import { Module } from '@nestjs/common';
import { ApiKeyService } from './apikey.service';
import { ApiKeyResolver } from './apikey.resolver';
import { ApiKeyGuard } from './apikey.guard';

@Module({
  providers: [ApiKeyService, ApiKeyResolver, ApiKeyGuard],
  exports: [ApiKeyService, ApiKeyGuard],
})
export class ApiKeyModule {}
