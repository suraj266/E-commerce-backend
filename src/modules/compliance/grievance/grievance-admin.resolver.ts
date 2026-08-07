/**
 * GrievanceAdminResolver — the Grievance-Officer / admin console (CP-EC, P4-01).
 *
 * Reads (queue + detail + the monthly compliance report) are gated by
 * `grievance:read`; the workflow actions (assign / respond / resolve / escalate /
 * close) by `grievance:manage`. Both slugs must be seeded in
 * rolePermission.seed.ts (CENTRAL-WIRING TODO) and granted only to the grievance
 * team.
 *
 * The compliance report is returned both as a structured object (for the admin
 * view) and as a JSON STRING (for export) — the codebase registers no JSON
 * scalar, so the export mirrors AuditLog/TCS. It is a PROVISIONAL operational
 * roll-up — every payload embeds a `disclaimer`; the schema + filing cadence
 * NEED LEGAL SIGN-OFF.
 */

import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { GrievanceService } from './grievance.service';
import {
  GrievanceEntity,
  GrievanceComplianceReport,
  PaginatedGrievances,
} from './entities/grievance.entities';
import { GrievanceFilterInput } from './dto/grievance-filter.input';
import { AssignGrievanceInput } from './dto/assign-grievance.input';
import { GrievanceMessageInput } from './dto/grievance-message.input';
import { ResolveGrievanceInput } from './dto/resolve-grievance.input';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertPeriod(period: string): void {
  if (!PERIOD_RE.test(period)) {
    throw new BadRequestException(
      `Invalid period "${period}" — expected YYYY-MM (e.g. 2026-07).`,
    );
  }
}

@Resolver()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class GrievanceAdminResolver {
  constructor(private readonly grievance: GrievanceService) {}

  // --- Reads (grievance:read) ------------------------------------------------

  /** Cross-customer grievance queue, filterable. Auth: grievance:read. */
  @Permissions('grievance:read')
  @Query(() => PaginatedGrievances, { name: 'adminGrievances' })
  async adminGrievances(
    @Args('filter', { nullable: true }) filter?: GrievanceFilterInput,
  ): Promise<PaginatedGrievances> {
    return this.grievance.listGrievances(filter ?? {});
  }

  /** One grievance's detail with the full thread (internal notes included). Auth: grievance:read. */
  @Permissions('grievance:read')
  @Query(() => GrievanceEntity, { name: 'adminGrievance' })
  async adminGrievance(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<GrievanceEntity> {
    return this.grievance.adminGrievanceDetail(id);
  }

  /** CP-EC monthly compliance report for a YYYY-MM period. Auth: grievance:read. */
  @Permissions('grievance:read')
  @Query(() => GrievanceComplianceReport, { name: 'grievanceComplianceReport' })
  async grievanceComplianceReport(
    @Args('period') period: string,
  ): Promise<GrievanceComplianceReport> {
    assertPeriod(period);
    return this.grievance.buildMonthlyComplianceReport(period);
  }

  /** The same monthly compliance report as a JSON string (export). Auth: grievance:read. */
  @Permissions('grievance:read')
  @Query(() => String, { name: 'grievanceComplianceReportJson' })
  async grievanceComplianceReportJson(
    @Args('period') period: string,
  ): Promise<string> {
    assertPeriod(period);
    return JSON.stringify(
      await this.grievance.buildMonthlyComplianceReport(period),
    );
  }

  // --- Mutations (grievance:manage) ------------------------------------------

  /** Assign / re-assign a ticket to an officer (optionally re-prioritise). Auth: grievance:manage. */
  @Permissions('grievance:manage')
  @Mutation(() => GrievanceEntity, { name: 'assignGrievance' })
  async assignGrievance(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: AssignGrievanceInput,
  ): Promise<GrievanceEntity> {
    return this.grievance.assignGrievance(user.userId, input);
  }

  /** Officer posts a response (or an internal note) on the thread. Auth: grievance:manage. */
  @Permissions('grievance:manage')
  @Mutation(() => GrievanceEntity, { name: 'respondToGrievance' })
  async respondToGrievance(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: GrievanceMessageInput,
  ): Promise<GrievanceEntity> {
    return this.grievance.respondToGrievance(user.userId, input);
  }

  /** Record the resolution and move the ticket to RESOLVED. Auth: grievance:manage. */
  @Permissions('grievance:manage')
  @Mutation(() => GrievanceEntity, { name: 'resolveGrievance' })
  async resolveGrievance(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: ResolveGrievanceInput,
  ): Promise<GrievanceEntity> {
    return this.grievance.resolveGrievance(user.userId, input);
  }

  /** Manually escalate a still-open ticket. Auth: grievance:manage. */
  @Permissions('grievance:manage')
  @Mutation(() => GrievanceEntity, { name: 'escalateGrievance' })
  async escalateGrievance(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('note', { type: () => String, nullable: true }) note?: string,
  ): Promise<GrievanceEntity> {
    return this.grievance.escalateGrievance(user.userId, id, note);
  }

  /** Close a resolved ticket (terminal). Auth: grievance:manage. */
  @Permissions('grievance:manage')
  @Mutation(() => GrievanceEntity, { name: 'closeGrievance' })
  async closeGrievance(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<GrievanceEntity> {
    return this.grievance.closeGrievance(user.userId, id);
  }
}
