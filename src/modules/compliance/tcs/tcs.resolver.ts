/**
 * TcsResolver — permission-gated admin surface over the §52 TCS ledger (P3-03).
 *
 * Reads are gated by `tcs:read`; the deposit mark (a compliance state change) by
 * `tcs:manage`. Both permissions must be seeded in rolePermission.seed.ts
 * (CENTRAL-WIRING TODO) and granted only to finance/compliance roles.
 *
 * The GSTR-8 / GSTR-1 exports are returned as JSON STRINGS (the codebase
 * registers no JSON scalar — mirrors AuditLogEntity.before/after). They are
 * PROVISIONAL computations, not filing-ready returns — every payload embeds a
 * `disclaimer` + `schemaVersion` that NEEDS CA SIGN-OFF.
 */

import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { TcsService } from './tcs.service';
import { TcsLedgerFilterInput } from './dto/tcs-ledger-filter.input';
import { MarkTcsDepositedInput } from './dto/mark-tcs-deposited.input';
import {
  PaginatedTcsLedger,
  TcsPeriodSummary,
  TcsDepositEntity,
} from './entities/tcs.entities';

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
export class TcsResolver {
  constructor(private readonly tcs: TcsService) {}

  // --- Reads (tcs:read) ------------------------------------------------------

  /** Paginated §52 TCS ledger, filterable by period/seller/etc. Auth: tcs:read. */
  @Permissions('tcs:read')
  @Query(() => PaginatedTcsLedger, { name: 'tcsLedger' })
  async tcsLedger(
    @Args('filter', { nullable: true }) filter?: TcsLedgerFilterInput,
  ): Promise<PaginatedTcsLedger> {
    return this.tcs.listLedger(filter ?? {});
  }

  /** TCS totals rolled up for a YYYY-MM period. Auth: tcs:read. */
  @Permissions('tcs:read')
  @Query(() => TcsPeriodSummary, { name: 'tcsPeriodSummary' })
  async tcsPeriodSummary(
    @Args('period') period: string,
  ): Promise<TcsPeriodSummary> {
    assertPeriod(period);
    return this.tcs.aggregatePeriod(period);
  }

  /** List the per-period TCS deposit roll-up records. Auth: tcs:read. */
  @Permissions('tcs:read')
  @Query(() => [TcsDepositEntity], { name: 'tcsDeposits' })
  async tcsDeposits(): Promise<TcsDepositEntity[]> {
    return this.tcs.listDeposits() as unknown as Promise<TcsDepositEntity[]>;
  }

  /** GSTR-8 (operator TCS return) JSON for a period. Provisional — see disclaimer. */
  @Permissions('tcs:read')
  @Query(() => String, { name: 'tcsGstr8Json' })
  async tcsGstr8Json(@Args('period') period: string): Promise<string> {
    assertPeriod(period);
    return JSON.stringify(await this.tcs.buildGstr8(period));
  }

  /** Seller GSTR-1 (marketplace-channel outward supplies) JSON. Provisional. */
  @Permissions('tcs:read')
  @Query(() => String, { name: 'tcsSellerGstr1Json' })
  async tcsSellerGstr1Json(
    @Args('period') period: string,
    @Args('sellerId') sellerId: string,
  ): Promise<string> {
    assertPeriod(period);
    return JSON.stringify(await this.tcs.buildSellerGstr1(period, sellerId));
  }

  // --- Mutations (tcs:manage) ------------------------------------------------

  /**
   * Refresh + roll up a period into its TcsDeposit (PENDING). Idempotent; used
   * before generating an export or reconciling a month.
   */
  @Permissions('tcs:manage')
  @Mutation(() => TcsDepositEntity, { name: 'refreshTcsDeposit' })
  async refreshTcsDeposit(
    @Args('period') period: string,
  ): Promise<TcsDepositEntity> {
    assertPeriod(period);
    return this.tcs.getOrRefreshDeposit(
      period,
    ) as unknown as Promise<TcsDepositEntity>;
  }

  /**
   * Record that the CA has filed GSTR-8 + paid the challan for a period. This is
   * a bookkeeping mark only — the actual filing/payment happened outside the
   * system.
   */
  @Permissions('tcs:manage')
  @Mutation(() => TcsDepositEntity, { name: 'markTcsDeposited' })
  async markTcsDeposited(
    @Args('input') input: MarkTcsDepositedInput,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<TcsDepositEntity> {
    assertPeriod(input.period);
    return this.tcs.markDeposited({
      period: input.period,
      challanRef: input.challanRef,
      depositedById: user.userId,
    }) as unknown as Promise<TcsDepositEntity>;
  }
}
