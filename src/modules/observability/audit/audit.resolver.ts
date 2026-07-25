/**
 * AuditResolver — permission-gated read access to the audit trail.
 *
 * Gated by PermissionsGuard with `audit:read`. This permission must be seeded
 * in rolePermission.seed.ts (CENTRAL-WIRING TODO) and granted only to the
 * roles allowed to inspect the security trail. There is intentionally NO write
 * mutation: rows are created only via AuditService.record(), and the table is
 * append-only at the DB.
 */

import { Args, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import { AuditService } from './audit.service';
import { PaginatedAuditLogs } from './entities/audit-log.entity';
import { AuditLogFilterInput } from './dto/audit-log-filter.input';

@Resolver()
export class AuditResolver {
  constructor(private readonly audit: AuditService) {}

  /** Paginated, filtered read of the append-only audit trail (newest first). Auth: audit:read permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('audit:read')
  @Query(() => PaginatedAuditLogs, { name: 'auditLogs' })
  async auditLogs(
    @Args('filter', { nullable: true }) filter?: AuditLogFilterInput,
  ): Promise<PaginatedAuditLogs> {
    return this.audit.list(filter ?? {});
  }
}
