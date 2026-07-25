/**
 * TcsService — marketplace Tax-Collected-at-Source (§52) accrual / ledger /
 * export engine (Phase 3, P3-03).
 *
 * COMPUTES / LEDGERS / EXPORTS only. It never files anything: GSTR-8 + the
 * challan deposit are a MANUAL CA action. Every rate/base/threshold it uses is
 * a `// NEEDS CA SIGN-OFF` constant in tcs.constants.ts.
 *
 * Write surface (all idempotent, all tx-aware where they mutate the money path):
 *   - accrue(tx, sellerOrderId) : + one ACCRUAL row at the SAME commit point as
 *       the invoice (prepaid capture in PaymentService.finalizeCapturedPayment,
 *       and the COD-confirm equivalent — see CENTRAL-WIRING note).
 *   - reverse(tx, refund, scoped): − one REVERSAL row per affected seller order
 *       inside RefundService.finalizeRefund's transaction.
 *   - netForSellerOrders(): net accrued-minus-reversed TCS per seller order, so
 *       PayoutService can withhold it from the seller's payable.
 *
 * Read/close surface (admin, permission-gated at the resolver):
 *   - aggregatePeriod / getOrRefreshDeposit / markDeposited
 *   - buildGstr8 / buildSellerGstr1 (JSON exports)
 *   - listLedger / listDeposits
 *
 * Idempotency: an ACCRUAL is unique per seller-order and a REVERSAL unique per
 * (seller-order, refund) via PARTIAL UNIQUE INDEXES in the migration; writes go
 * through `createMany({ skipDuplicates:true })` (→ ON CONFLICT DO NOTHING) so a
 * double-finalize is a no-op WITHOUT aborting the caller's business transaction
 * — the same pattern OutboxService.enqueue uses.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TcsLedgerKind, TcsDepositStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { OutboxService } from '@/modules/outbox/outbox.service';
import { OUTBOX_QUEUE, OUTBOX_EVENT } from '@/modules/outbox/outbox.constants';
import {
  TCS_TOTAL_RATE_BPS,
  TCS_CGST_RATE_BPS,
  TCS_SGST_RATE_BPS,
  TCS_IGST_RATE_BPS,
  TCS_INCLUDE_SHIPPING_IN_BASE,
  TCS_EXEMPT_HSN_PREFIXES,
  TCS_MIN_TAXABLE_VALUE,
  TCS_DEPOSIT_DAY_OF_MONTH,
  GSTR8_SCHEMA_VERSION,
  GSTR1_SCHEMA_VERSION,
  TCS_EXPORT_DISCLAIMER,
} from './tcs.constants';

const D = (v: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(v);
const ZERO = new Prisma.Decimal(0);
/** Round to paise (2dp, half-up) — final ledger/deposit money. */
const d2 = (v: Prisma.Decimal): Prisma.Decimal =>
  v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
/** Round to 4dp (half-up) — GST-grade taxable-value precision. */
const d4 = (v: Prisma.Decimal): Prisma.Decimal =>
  v.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

/** `YYYY-MM` for a date, using local calendar (matches invoice-number FY calc). */
export function toPeriod(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** [start, end) Date bounds for a `YYYY-MM` period. */
export function periodBounds(period: string): { start: Date; end: Date } {
  const [y, m] = period.split('-').map((n) => parseInt(n, 10));
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
}

function isExemptHsn(hsn: string | null | undefined): boolean {
  if (TCS_EXEMPT_HSN_PREFIXES.length === 0) return false;
  if (!hsn) return false;
  return TCS_EXEMPT_HSN_PREFIXES.some((p) => hsn.startsWith(p));
}

/** Minimal shape reverse() needs from a scoped seller order. */
export interface TcsReverseSellerOrder {
  id: string;
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  shippingAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
}

export interface TcsReverseRefund {
  id: string;
  amount: Prisma.Decimal;
  sellerOrderId: string | null;
}

/** A TcsDeposit with money coerced to plain numbers (GraphQL-Float-safe). */
export interface TcsDepositView {
  id: string;
  period: string;
  netTaxableValue: number;
  cgstTcs: number;
  sgstTcs: number;
  igstTcs: number;
  totalTcs: number;
  status: TcsDepositStatus;
  challanRef: string | null;
  depositedById: string | null;
  depositedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class TcsService {
  private readonly logger = new Logger(TcsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly outbox: OutboxService,
  ) {}

  // ---------------------------------------------------------------------------
  // Accrual — written INSIDE the caller's capture/confirm transaction.
  // ---------------------------------------------------------------------------

  /**
   * Accrue TCS for one seller-order. Idempotent (partial unique on the ledger →
   * skipDuplicates), so calling it from verify + webhook + reconcile, or twice,
   * writes at most one ACCRUAL row.
   *
   * MUST run on the caller's transaction client so the accrual commits
   * atomically with the PAID flip + invoice enqueue (same commit point as the
   * invoice — the whole point of §52 accrual-at-supply).
   *
   * Base = Σ per-line taxableValue (frozen at placement, exempt HSN excluded)
   *        [+ shipping composite-supply taxable value, if enabled].
   */
  async accrue(
    tx: Prisma.TransactionClient,
    sellerOrderId: string,
    on: Date = new Date(),
  ): Promise<void> {
    const so = await tx.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      select: {
        id: true,
        storeId: true,
        sellerId: true,
        taxKind: true,
        shippingTaxableValue: true,
      },
    });
    if (!so) return;

    const taxKind = so.taxKind;
    if (taxKind !== 'INTRA_STATE' && taxKind !== 'INTER_STATE') {
      // taxKind is frozen at placement; a missing value means we cannot know the
      // split. Do NOT guess a tax treatment — skip + surface it.
      this.logger.warn(
        `TCS accrual skipped for seller-order ${sellerOrderId}: taxKind is "${taxKind}" (expected INTRA_STATE|INTER_STATE).`,
      );
      return;
    }

    // Frozen per-line taxable values (exempt HSN excluded).
    const items = await tx.orderItem.findMany({
      where: { sellerOrderId },
      select: { taxableValue: true, hsnCode: true },
    });
    let base = ZERO;
    for (const it of items) {
      if (isExemptHsn(it.hsnCode)) continue;
      base = base.add(it.taxableValue);
    }
    if (TCS_INCLUDE_SHIPPING_IN_BASE) {
      base = base.add(so.shippingTaxableValue ?? ZERO);
    }
    base = d4(base);

    if (base.lte(TCS_MIN_TAXABLE_VALUE)) return; // nothing collectible

    const { cgstTcs, sgstTcs, igstTcs } = this.split(base, taxKind);

    await tx.tcsLedger.createMany({
      data: [
        {
          kind: TcsLedgerKind.ACCRUAL,
          period: toPeriod(on),
          storeId: so.storeId,
          sellerId: so.sellerId,
          sellerOrderId: so.id,
          refundId: null,
          netTaxableValue: base,
          cgstTcs,
          sgstTcs,
          igstTcs,
          rateBps: TCS_TOTAL_RATE_BPS,
          taxKind,
        },
      ],
      skipDuplicates: true,
    });
  }

  // ---------------------------------------------------------------------------
  // Reversal — written INSIDE RefundService.finalizeRefund's transaction.
  // ---------------------------------------------------------------------------

  /**
   * Write a NEGATIVE REVERSAL row per affected seller order that has an ACCRUAL.
   * The reversal is PROPORTIONAL to the share of that seller order being
   * refunded — a partial refund reverses a proportional slice of the accrued
   * TCS; a full refund reverses (approximately) all of it. Idempotent: partial
   * unique on (sellerOrderId, refundId) WHERE kind='REVERSAL' → one reversal row
   * per refund per seller order.
   *
   * // NEEDS CA SIGN-OFF — reversal basis (proportional-to-refund) + timing
   *    (reversal booked in the refund month vs a credit note against the supply).
   */
  async reverse(
    tx: Prisma.TransactionClient,
    refund: TcsReverseRefund,
    scoped: TcsReverseSellerOrder[],
    on: Date = new Date(),
  ): Promise<void> {
    if (scoped.length === 0) return;
    const soIds = scoped.map((s) => s.id);

    const accruals = await tx.tcsLedger.findMany({
      where: { sellerOrderId: { in: soIds }, kind: TcsLedgerKind.ACCRUAL },
    });
    if (accruals.length === 0) return; // nothing accrued → nothing to reverse
    const accrualBySo = new Map(accruals.map((a) => [a.sellerOrderId, a]));

    // Reversals ALREADY booked against these seller orders by OTHER refunds.
    // We clamp this refund's reversal to the remaining (accrued − already-
    // reversed) balance so cumulative reversal can never exceed the accrual —
    // otherwise multiple refunds on one seller order over-reverse and understate
    // the GSTR-8 deposit. Excludes this refund's own rows so a retry is stable.
    const priorReversals = await tx.tcsLedger.groupBy({
      by: ['sellerOrderId'],
      where: {
        sellerOrderId: { in: soIds },
        kind: TcsLedgerKind.REVERSAL,
        refundId: { not: refund.id },
      },
      _sum: {
        cgstTcs: true,
        sgstTcs: true,
        igstTcs: true,
        netTaxableValue: true,
      },
    });
    const reversedBySo = new Map(
      priorReversals.map((r) => [r.sellerOrderId, r._sum]),
    );

    // Clamp a proposed positive reversal magnitude to the remaining reversible
    // balance. `priorSum` is <= 0 (reversal rows are negative), so
    // remaining = accrued + priorSum. Never returns more than remaining, never
    // negative.
    const clampMag = (
      proposed: Prisma.Decimal,
      accrued: Prisma.Decimal,
      priorSum: Prisma.Decimal | null | undefined,
    ): Prisma.Decimal => {
      const remaining = accrued.add(priorSum ?? ZERO);
      const cap = remaining.lt(ZERO) ? ZERO : remaining;
      return proposed.gt(cap) ? cap : proposed;
    };

    // Gross (payment-facing) total per seller order — the denominator the refund
    // proportion is measured against.
    const grossBySo = new Map<string, Prisma.Decimal>();
    for (const s of scoped) {
      grossBySo.set(s.id, d2(this.sellerOrderGross(s)));
    }
    const orderGross = scoped.reduce(
      (acc, s) => acc.add(grossBySo.get(s.id) ?? ZERO),
      ZERO,
    );

    const refundAmt = D(refund.amount);
    const rows: Prisma.TcsLedgerCreateManyInput[] = [];

    for (const s of scoped) {
      const accr = accrualBySo.get(s.id);
      if (!accr) continue;
      const soGross = grossBySo.get(s.id) ?? ZERO;
      if (soGross.lte(0)) continue;

      // Refund amount attributable to THIS seller order.
      const refundShare = refund.sellerOrderId
        ? refundAmt // refund is already scoped to this single seller order
        : orderGross.gt(0)
          ? refundAmt.mul(soGross).div(orderGross) // order-level: pro-rata by gross
          : ZERO;

      // Proportion of the accrual to reverse, capped at 1 (never reverse more
      // than was accrued for a single refund).
      let proportion = refundShare.div(soGross);
      if (proportion.gt(1)) proportion = D(1);
      if (proportion.lte(0)) continue;

      // Cumulative clamp: this refund's proportional slice, but never more than
      // the balance left unreversed after prior refunds on this seller order.
      const prior = reversedBySo.get(s.id);
      const cgstMag = clampMag(
        d2(D(accr.cgstTcs).mul(proportion)),
        D(accr.cgstTcs),
        prior?.cgstTcs ? D(prior.cgstTcs) : ZERO,
      );
      const sgstMag = clampMag(
        d2(D(accr.sgstTcs).mul(proportion)),
        D(accr.sgstTcs),
        prior?.sgstTcs ? D(prior.sgstTcs) : ZERO,
      );
      const igstMag = clampMag(
        d2(D(accr.igstTcs).mul(proportion)),
        D(accr.igstTcs),
        prior?.igstTcs ? D(prior.igstTcs) : ZERO,
      );
      const netMag = clampMag(
        d4(D(accr.netTaxableValue).mul(proportion)),
        D(accr.netTaxableValue),
        prior?.netTaxableValue ? D(prior.netTaxableValue) : ZERO,
      );

      // Fully reversed already (nothing left to claw back) → no row.
      if (
        cgstMag.lte(ZERO) &&
        sgstMag.lte(ZERO) &&
        igstMag.lte(ZERO) &&
        netMag.lte(ZERO)
      ) {
        continue;
      }

      rows.push({
        kind: TcsLedgerKind.REVERSAL,
        period: toPeriod(on),
        storeId: accr.storeId,
        sellerId: accr.sellerId,
        sellerOrderId: s.id,
        refundId: refund.id,
        netTaxableValue: netMag.negated(),
        cgstTcs: cgstMag.negated(),
        sgstTcs: sgstMag.negated(),
        igstTcs: igstMag.negated(),
        rateBps: accr.rateBps,
        taxKind: accr.taxKind,
      });
    }

    if (rows.length > 0) {
      await tx.tcsLedger.createMany({ data: rows, skipDuplicates: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Payout netting — read side used by PayoutService.
  // ---------------------------------------------------------------------------

  /**
   * Net accrued-minus-reversed TCS per seller order, floored at 0. The operator
   * withholds this from the seller's payable and deposits it to the government.
   * A single groupBy over BOTH kinds nets naturally (accruals +, reversals −).
   */
  async netForSellerOrders(
    sellerOrderIds: string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (sellerOrderIds.length === 0) return out;

    const rows = await this.prisma.tcsLedger.groupBy({
      by: ['sellerOrderId'],
      where: { sellerOrderId: { in: sellerOrderIds } },
      _sum: { cgstTcs: true, sgstTcs: true, igstTcs: true },
    });

    for (const r of rows) {
      const net = D(r._sum.cgstTcs ?? 0)
        .add(r._sum.sgstTcs ?? 0)
        .add(r._sum.igstTcs ?? 0);
      const floored = net.lt(0) ? 0 : d2(net).toNumber();
      out.set(r.sellerOrderId, floored);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Monthly aggregate + deposit lifecycle.
  // ---------------------------------------------------------------------------

  /** Roll the ledger up for a period (accruals − reversals). */
  async aggregatePeriod(period: string): Promise<{
    period: string;
    netTaxableValue: number;
    cgstTcs: number;
    sgstTcs: number;
    igstTcs: number;
    totalTcs: number;
  }> {
    const agg = await this.prisma.tcsLedger.aggregate({
      where: { period },
      _sum: {
        netTaxableValue: true,
        cgstTcs: true,
        sgstTcs: true,
        igstTcs: true,
      },
    });
    const cgst = d2(D(agg._sum.cgstTcs ?? 0));
    const sgst = d2(D(agg._sum.sgstTcs ?? 0));
    const igst = d2(D(agg._sum.igstTcs ?? 0));
    return {
      period,
      netTaxableValue: d2(D(agg._sum.netTaxableValue ?? 0)).toNumber(),
      cgstTcs: cgst.toNumber(),
      sgstTcs: sgst.toNumber(),
      igstTcs: igst.toNumber(),
      totalTcs: cgst.add(sgst).add(igst).toNumber(),
    };
  }

  /**
   * Ensure a TcsDeposit row exists for the period and (while still PENDING)
   * refresh its snapshot from the live ledger roll-up. A DEPOSITED row is frozen
   * — its as-filed snapshot is never overwritten. Returns plain numbers (the
   * GraphQL Float scalar can't serialise a Prisma.Decimal).
   */
  async getOrRefreshDeposit(period: string): Promise<TcsDepositView> {
    const existing = await this.prisma.tcsDeposit.findUnique({
      where: { period },
    });
    if (existing && existing.status === TcsDepositStatus.DEPOSITED) {
      return this.mapDeposit(existing);
    }
    const agg = await this.aggregatePeriod(period);
    const row = await this.prisma.tcsDeposit.upsert({
      where: { period },
      update: {
        netTaxableValue: agg.netTaxableValue,
        cgstTcs: agg.cgstTcs,
        sgstTcs: agg.sgstTcs,
        igstTcs: agg.igstTcs,
        totalTcs: agg.totalTcs,
      },
      create: {
        period,
        netTaxableValue: agg.netTaxableValue,
        cgstTcs: agg.cgstTcs,
        sgstTcs: agg.sgstTcs,
        igstTcs: agg.igstTcs,
        totalTcs: agg.totalTcs,
        status: TcsDepositStatus.PENDING,
      },
    });
    return this.mapDeposit(row);
  }

  /**
   * Admin marks a period's TCS as DEPOSITED after the CA files GSTR-8 + pays the
   * challan. Refreshes the snapshot first, then freezes it with the challan ref.
   * Idempotent: re-marking a DEPOSITED period just updates the challan ref.
   */
  async markDeposited(input: {
    period: string;
    challanRef: string;
    depositedById?: string | null;
  }): Promise<TcsDepositView> {
    await this.getOrRefreshDeposit(input.period);
    const row = await this.prisma.tcsDeposit.update({
      where: { period: input.period },
      data: {
        status: TcsDepositStatus.DEPOSITED,
        challanRef: input.challanRef,
        depositedById: input.depositedById ?? null,
        depositedAt: new Date(),
      },
    });
    return this.mapDeposit(row);
  }

  async listDeposits(limit = 24): Promise<TcsDepositView[]> {
    const rows = await this.prisma.tcsDeposit.findMany({
      orderBy: { period: 'desc' },
      take: Math.min(120, Math.max(1, limit)),
    });
    return rows.map((r) => this.mapDeposit(r));
  }

  async listLedger(filter: {
    period?: string;
    sellerId?: string;
    kind?: TcsLedgerKind;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
    const where: Prisma.TcsLedgerWhereInput = {
      ...(filter.period ? { period: filter.period } : {}),
      ...(filter.sellerId ? { sellerId: filter.sellerId } : {}),
      ...(filter.kind ? { kind: filter.kind } : {}),
    };
    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.tcsLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.tcsLedger.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        period: r.period,
        storeId: r.storeId,
        sellerId: r.sellerId,
        sellerOrderId: r.sellerOrderId,
        refundId: r.refundId,
        netTaxableValue: D(r.netTaxableValue).toNumber(),
        cgstTcs: D(r.cgstTcs).toNumber(),
        sgstTcs: D(r.sgstTcs).toNumber(),
        igstTcs: D(r.igstTcs).toNumber(),
        rateBps: r.rateBps,
        taxKind: r.taxKind,
        createdAt: r.createdAt,
      })),
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      currentPage: page,
      pageSize,
    };
  }

  // ---------------------------------------------------------------------------
  // Exports (JSON). Structured objects; the resolver JSON.stringifies them.
  // ---------------------------------------------------------------------------

  /**
   * GSTR-8 (operator TCS return) JSON for a period: operator identity + period
   * roll-up + GSTIN-wise supplier detail. Schema version + disclaimer stamped in.
   *
   * // NEEDS CA SIGN-OFF — GSTR-8 schema version + the operator-GSTIN source.
   */
  async buildGstr8(period: string): Promise<Record<string, unknown>> {
    const supplierRows = await this.prisma.tcsLedger.groupBy({
      by: ['sellerId'],
      where: { period },
      _sum: {
        netTaxableValue: true,
        cgstTcs: true,
        sgstTcs: true,
        igstTcs: true,
      },
    });

    const sellerIds = supplierRows.map((r) => r.sellerId);
    const sellers = await this.prisma.seller.findMany({
      where: { id: { in: sellerIds } },
      select: {
        id: true,
        gstin: true,
        legalName: true,
        stateCode: true,
      },
    });
    const sellerById = new Map(sellers.map((s) => [s.id, s]));

    const suppliers = supplierRows.map((r) => {
      const s = sellerById.get(r.sellerId);
      return {
        sellerId: r.sellerId,
        gstin: s?.gstin ?? null, // null ⇒ unregistered supplier — CA to handle
        legalName: s?.legalName ?? null,
        stateCode: s?.stateCode ?? null,
        netTaxableValue: d2(D(r._sum.netTaxableValue ?? 0)).toNumber(),
        cgstTcs: d2(D(r._sum.cgstTcs ?? 0)).toNumber(),
        sgstTcs: d2(D(r._sum.sgstTcs ?? 0)).toNumber(),
        igstTcs: d2(D(r._sum.igstTcs ?? 0)).toNumber(),
      };
    });

    const totals = await this.aggregatePeriod(period);

    return {
      schemaVersion: GSTR8_SCHEMA_VERSION, // NEEDS CA SIGN-OFF
      disclaimer: TCS_EXPORT_DISCLAIMER,
      return: 'GSTR-8',
      period, // YYYY-MM
      operator: {
        gstin: this.config.get<string>('OPERATOR_GSTIN') ?? null, // NEEDS CA SIGN-OFF (env)
        legalName: this.config.get<string>('OPERATOR_LEGAL_NAME') ?? null,
      },
      rate: {
        totalBps: TCS_TOTAL_RATE_BPS,
        cgstBps: TCS_CGST_RATE_BPS,
        sgstBps: TCS_SGST_RATE_BPS,
        igstBps: TCS_IGST_RATE_BPS,
      },
      summary: totals,
      supplierCount: suppliers.length,
      suppliers,
    };
  }

  /**
   * Seller GSTR-1 (outward supplies) JSON for one seller's sales THROUGH the
   * marketplace in a period, aggregated from the frozen per-line GST. Summary +
   * rate-wise + place-of-supply-wise breakup.
   *
   * // NEEDS CA SIGN-OFF — GSTR-1 schema version + B2B/B2C sectioning rules.
   */
  async buildSellerGstr1(
    period: string,
    sellerId: string,
  ): Promise<Record<string, unknown>> {
    const { start, end } = periodBounds(period);
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, gstin: true, legalName: true, stateCode: true },
    });

    // Invoices dated in the period (supply date = invoiceDate; only invoiced
    // seller-orders are reportable outward supplies).
    const sellerOrders = await this.prisma.sellerOrder.findMany({
      where: {
        sellerId,
        deletedAt: null,
        invoiceNumber: { not: null },
        invoiceDate: { gte: start, lt: end },
      },
      include: {
        items: {
          select: {
            taxableValue: true,
            cgstRate: true,
            sgstRate: true,
            igstRate: true,
            cgstAmount: true,
            sgstAmount: true,
            igstAmount: true,
            cessAmount: true,
          },
        },
      },
    });

    // Rate-wise buckets keyed by (taxKind, effectiveGstRatePct, placeOfSupply).
    const buckets = new Map<
      string,
      {
        taxKind: string;
        gstRatePct: number;
        placeOfSupplyStateCode: string | null;
        taxableValue: Prisma.Decimal;
        cgst: Prisma.Decimal;
        sgst: Prisma.Decimal;
        igst: Prisma.Decimal;
        cess: Prisma.Decimal;
      }
    >();

    const grand = {
      taxableValue: ZERO,
      cgst: ZERO,
      sgst: ZERO,
      igst: ZERO,
      cess: ZERO,
    };

    for (const so of sellerOrders) {
      const pos = so.placeOfSupplyStateCode ?? null;
      const taxKind = so.taxKind ?? 'UNKNOWN';
      for (const it of so.items) {
        const ratePct =
          taxKind === 'INTER_STATE'
            ? D(it.igstRate).toNumber()
            : D(it.cgstRate).add(it.sgstRate).toNumber();
        const key = `${taxKind}|${ratePct}|${pos ?? ''}`;
        let b = buckets.get(key);
        if (!b) {
          b = {
            taxKind,
            gstRatePct: ratePct,
            placeOfSupplyStateCode: pos,
            taxableValue: ZERO,
            cgst: ZERO,
            sgst: ZERO,
            igst: ZERO,
            cess: ZERO,
          };
          buckets.set(key, b);
        }
        b.taxableValue = b.taxableValue.add(it.taxableValue);
        b.cgst = b.cgst.add(it.cgstAmount);
        b.sgst = b.sgst.add(it.sgstAmount);
        b.igst = b.igst.add(it.igstAmount);
        b.cess = b.cess.add(it.cessAmount);
        grand.taxableValue = grand.taxableValue.add(it.taxableValue);
        grand.cgst = grand.cgst.add(it.cgstAmount);
        grand.sgst = grand.sgst.add(it.sgstAmount);
        grand.igst = grand.igst.add(it.igstAmount);
        grand.cess = grand.cess.add(it.cessAmount);
      }
    }

    // TCS the operator collected on this seller's supplies in the period
    // (informational — the seller claims it as credit).
    const tcs = await this.prisma.tcsLedger.aggregate({
      where: { period, sellerId },
      _sum: { cgstTcs: true, sgstTcs: true, igstTcs: true },
    });

    return {
      schemaVersion: GSTR1_SCHEMA_VERSION, // NEEDS CA SIGN-OFF
      disclaimer: TCS_EXPORT_DISCLAIMER,
      return: 'GSTR-1',
      note: 'Marketplace-channel supplies only. The seller must consolidate off-marketplace supplies before filing.',
      period,
      seller: {
        sellerId: seller?.id ?? sellerId,
        gstin: seller?.gstin ?? null,
        legalName: seller?.legalName ?? null,
        stateCode: seller?.stateCode ?? null,
      },
      invoiceCount: sellerOrders.length,
      summary: {
        taxableValue: d2(grand.taxableValue).toNumber(),
        cgst: d2(grand.cgst).toNumber(),
        sgst: d2(grand.sgst).toNumber(),
        igst: d2(grand.igst).toNumber(),
        cess: d2(grand.cess).toNumber(),
      },
      rateWise: [...buckets.values()].map((b) => ({
        taxKind: b.taxKind,
        gstRatePct: b.gstRatePct,
        placeOfSupplyStateCode: b.placeOfSupplyStateCode,
        taxableValue: d2(b.taxableValue).toNumber(),
        cgst: d2(b.cgst).toNumber(),
        sgst: d2(b.sgst).toNumber(),
        igst: d2(b.igst).toNumber(),
        cess: d2(b.cess).toNumber(),
      })),
      tcsCollectedByOperator: {
        cgstTcs: d2(D(tcs._sum.cgstTcs ?? 0)).toNumber(),
        sgstTcs: d2(D(tcs._sum.sgstTcs ?? 0)).toNumber(),
        igstTcs: d2(D(tcs._sum.igstTcs ?? 0)).toNumber(),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Deposit-reminder (invoked by TcsDepositReminderCron).
  // ---------------------------------------------------------------------------

  /**
   * If the previous month's deposit is still PENDING and we are inside the
   * by-10th window, refresh its snapshot and enqueue a deduped reminder email
   * (durable, one per period). Returns the period reminded, or null if nothing
   * was due. Called by the cron; safe to call repeatedly (dedupeKey).
   */
  async runDepositReminder(now: Date = new Date()): Promise<string | null> {
    // Only nudge during the deposit window (1st … deadline of the month after
    // the supply month).
    const dom = now.getDate();
    if (dom > TCS_DEPOSIT_DAY_OF_MONTH + 3) {
      // A few days of grace past the deadline for late nudges, then stop.
      return null;
    }
    // Previous calendar month = the period now due.
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const period = toPeriod(prev);

    const deposit = await this.getOrRefreshDeposit(period);
    if (deposit.status === TcsDepositStatus.DEPOSITED) return null;
    if (D(deposit.totalTcs).lte(0)) return null; // nothing to deposit

    // WIRE-OUTBOX: `email.tcs_deposit_reminder` (EMAILS queue). The central
    // EmailsProcessor must route this type to `sendDepositReminderEmail(period)`
    // once TcsModule is imported by OutboxModule. Enqueued in-tx, deduped by
    // period so exactly one reminder fires per period regardless of cron cadence.
    await this.prisma.$transaction(async (tx) => {
      await this.outbox.enqueue(tx, {
        type: OUTBOX_EVENT.TCS_DEPOSIT_REMINDER,
        queue: OUTBOX_QUEUE.EMAILS,
        payload: { period },
        dedupeKey: `tcs-deposit-reminder:${period}`,
      });
    });

    this.logger.warn(
      `TCS deposit for ${period} is still PENDING (total ₹${D(deposit.totalTcs).toFixed(2)}). ` +
        `File GSTR-8 + pay the challan by the 10th, then mark it DEPOSITED.`,
    );
    return period;
  }

  /**
   * Outbox handler for `email.tcs_deposit_reminder`. Idempotent + best-effort:
   * re-reads the deposit and logs the outstanding obligation. Emailing ops is
   * wired centrally (needs an ops address + template) — until then this is the
   * durable, retryable record that the reminder fired.
   *
   * // CENTRAL-WIRING: provide TCS_OPS_EMAIL + a `tcs_deposit_reminder` email
   *    template, then send here.
   */
  async sendDepositReminderEmail(period: string): Promise<void> {
    const deposit = await this.prisma.tcsDeposit.findUnique({
      where: { period },
    });
    if (!deposit || deposit.status === TcsDepositStatus.DEPOSITED) return;
    this.logger.warn(
      `[TCS reminder] Period ${period}: ₹${D(deposit.totalTcs).toFixed(2)} TCS pending deposit (GSTR-8, by the 10th).`,
    );
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Split a taxable base into the CGST/SGST or IGST TCS components (paise). */
  private split(
    base: Prisma.Decimal,
    taxKind: 'INTRA_STATE' | 'INTER_STATE',
  ): { cgstTcs: Prisma.Decimal; sgstTcs: Prisma.Decimal; igstTcs: Prisma.Decimal } {
    if (taxKind === 'INTRA_STATE') {
      return {
        cgstTcs: d2(base.mul(TCS_CGST_RATE_BPS).div(10000)),
        sgstTcs: d2(base.mul(TCS_SGST_RATE_BPS).div(10000)),
        igstTcs: ZERO,
      };
    }
    return {
      cgstTcs: ZERO,
      sgstTcs: ZERO,
      igstTcs: d2(base.mul(TCS_IGST_RATE_BPS).div(10000)),
    };
  }

  /** subtotal + tax + shipping − discount (the payment-facing gross). */
  private sellerOrderGross(so: TcsReverseSellerOrder): Prisma.Decimal {
    return D(so.subtotal)
      .add(so.taxAmount)
      .add(so.shippingAmount)
      .sub(so.discountAmount);
  }

  /** Coerce a Prisma TcsDeposit row's Decimals to plain numbers for GraphQL. */
  private mapDeposit(row: {
    id: string;
    period: string;
    netTaxableValue: Prisma.Decimal;
    cgstTcs: Prisma.Decimal;
    sgstTcs: Prisma.Decimal;
    igstTcs: Prisma.Decimal;
    totalTcs: Prisma.Decimal;
    status: TcsDepositStatus;
    challanRef: string | null;
    depositedById: string | null;
    depositedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): TcsDepositView {
    return {
      id: row.id,
      period: row.period,
      netTaxableValue: D(row.netTaxableValue).toNumber(),
      cgstTcs: D(row.cgstTcs).toNumber(),
      sgstTcs: D(row.sgstTcs).toNumber(),
      igstTcs: D(row.igstTcs).toNumber(),
      totalTcs: D(row.totalTcs).toNumber(),
      status: row.status,
      challanRef: row.challanRef,
      depositedById: row.depositedById,
      depositedAt: row.depositedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
