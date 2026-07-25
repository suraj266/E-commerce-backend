/**
 * PayoutService — seller settlement ledger (Phase 2, P2-02).
 *
 * Launch-minimum manual path:
 *   - previewPayoutRun : dry-run aggregate of eligible seller orders per seller,
 *                        netting out PROCESSED refunds. Nothing persisted.
 *   - createPayoutRun  : creates Payout(PROCESSING) + PayoutItems and flips the
 *                        included seller orders to payoutStatus=PROCESSING,
 *                        atomically per seller. The PayoutItem.sellerOrderId
 *                        @unique makes a racing double-run collide (P2002) — the
 *                        loser skips that seller, so an order settles at most once.
 *   - markPayoutPaid   : finance pastes the UTR; flips to PAID + seller orders to
 *                        PAID + fires seller_payout_disbursed.
 *   - markPayoutFailed : reverts seller orders to PENDING and deletes items so the
 *                        run can be re-attempted.
 *
 * Refund coupling: eligibility excludes fully-REFUNDED seller orders and
 * subtracts PROCESSED refunds attributed to a seller order from its net.
 */

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  OrderStatus,
  PaymentStatus,
  PayoutAdjustmentStatus,
  PayoutStatus,
  Prisma,
  RefundStatus,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { AuditService } from '@/modules/observability/audit/audit.service';
import { TcsService } from '@/modules/compliance/tcs/tcs.service';
import { MetricsService } from '@/modules/observability/metrics/metrics.service';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface PreviewItem {
  sellerOrderId: string;
  orderNumber: string;
  amount: number;
  refundedAmount: number;
  tcsDeducted: number;
}

export interface Preview {
  sellerId: string;
  sellerName: string;
  itemCount: number;
  grossAmount: number;
  refundAdjustment: number;
  /** Net accrued-minus-reversed §52 TCS withheld from this seller (P3-03). */
  tcsAdjustment: number;
  /** Return-driven commission clawback absorbed by this run (P3-02). */
  clawbackAdjustment: number;
  netAmount: number;
  currencyCode: string;
  items: PreviewItem[];
  /** Internal: PENDING PayoutAdjustment ids this run would mark APPLIED. */
  appliedAdjustmentIds: string[];
}

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    // Optional so the existing unit test (which constructs PayoutService with
    // just prisma+email) keeps compiling; the app always injects it
    // (AuditModule is @Global). Audit writes are best-effort. See P3-05.
    private readonly audit?: AuditService,
    // Optional trailing param (TcsModule is @Global). Used to withhold the
    // seller's net §52 TCS from their payable — skipped cleanly when absent
    // (unit tests) so the preview maths degrade to the pre-TCS behaviour. See P3-03.
    private readonly tcs?: TcsService,
    // Optional trailing param (MetricsModule is @Global). Counters are
    // fire-and-forget side effects guarded with `?.`; never alter payout maths.
    private readonly metrics?: MetricsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Preview (dry run)
  // ---------------------------------------------------------------------------

  async previewPayoutRun(sellerId?: string): Promise<Preview[]> {
    return this.buildPreview(sellerId);
  }

  /**
   * Aggregate eligible seller orders into per-seller previews.
   *
   * Eligible = DELIVERED + payoutStatus=PENDING + not-yet-settled (no PayoutItem)
   *            + paymentStatus in (PAID, PARTIALLY_REFUNDED) [excludes fully
   *            REFUNDED / unpaid], netting PROCESSED refunds out of each order's
   *            seller payout amount.
   */
  private async buildPreview(sellerId?: string): Promise<Preview[]> {
    const sellerOrders = await this.prisma.sellerOrder.findMany({
      where: {
        deletedAt: null,
        status: OrderStatus.DELIVERED,
        payoutStatus: PayoutStatus.PENDING,
        paymentStatus: {
          in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED],
        },
        payoutItem: { is: null }, // never settled before
        ...(sellerId ? { sellerId } : {}),
      },
      include: { seller: { select: { displayName: true } } },
    });

    if (sellerOrders.length === 0) return [];

    // PROCESSED refunds attributed directly to these seller orders.
    const soIds = sellerOrders.map((so) => so.id);
    const refundRows = await this.prisma.refund.groupBy({
      by: ['sellerOrderId'],
      where: {
        sellerOrderId: { in: soIds },
        status: RefundStatus.PROCESSED,
      },
      _sum: { amount: true },
    });
    const refundBySo = new Map<string, number>();
    for (const r of refundRows) {
      if (r.sellerOrderId) {
        refundBySo.set(r.sellerOrderId, Number(r._sum.amount ?? 0));
      }
    }

    // Net accrued-minus-reversed §52 TCS per seller order — withheld from the
    // seller and deposited to the government by the operator (P3-03). Absent in
    // unit tests (tcs undefined) → empty map → no TCS withheld (pre-TCS maths).
    const tcsBySo = this.tcs
      ? await this.tcs.netForSellerOrders(soIds)
      : new Map<string, number>();

    const bySeller = new Map<string, Preview>();
    for (const so of sellerOrders) {
      const gross = Number(so.payoutAmount);
      const refunded = Math.min(refundBySo.get(so.id) ?? 0, gross);
      // Withhold TCS, but never more than what's left after refunds.
      const tcs = Math.min(
        Math.max(0, tcsBySo.get(so.id) ?? 0),
        round2(gross - refunded),
      );
      const net = round2(gross - refunded - tcs);
      if (net <= 0) continue; // fully consumed by refunds + TCS — nothing to pay

      let entry = bySeller.get(so.sellerId);
      if (!entry) {
        entry = {
          sellerId: so.sellerId,
          sellerName: so.seller.displayName,
          itemCount: 0,
          grossAmount: 0,
          refundAdjustment: 0,
          tcsAdjustment: 0,
          clawbackAdjustment: 0,
          netAmount: 0,
          currencyCode: so.currencyCode,
          items: [],
          appliedAdjustmentIds: [],
        };
        bySeller.set(so.sellerId, entry);
      }
      entry.itemCount += 1;
      entry.grossAmount = round2(entry.grossAmount + gross);
      entry.refundAdjustment = round2(entry.refundAdjustment + refunded);
      entry.tcsAdjustment = round2(entry.tcsAdjustment + tcs);
      entry.netAmount = round2(entry.netAmount + net);
      entry.items.push({
        sellerOrderId: so.id,
        orderNumber: so.orderNumber,
        amount: round2(net),
        refundedAmount: round2(refunded),
        tcsDeducted: round2(tcs),
      });
    }

    // Return-driven commission clawbacks (P3-02): net PENDING PayoutAdjustments
    // out of each seller's payable, greedily and in FULL-adjustment units, oldest
    // first. An adjustment that would drive the payable negative is NOT absorbed
    // here — it stays PENDING and is carried forward to the next run. A seller is
    // never paid a negative. // NEEDS FINANCE SIGN-OFF — carry-forward rule.
    const sellerIds = [...bySeller.keys()];
    if (sellerIds.length > 0) {
      const pending =
        (await this.prisma.payoutAdjustment.findMany({
          where: {
            sellerId: { in: sellerIds },
            status: 'PENDING',
            kind: 'RETURN_CLAWBACK',
          },
          orderBy: { createdAt: 'asc' },
        })) ?? [];
      const bySellerAdj = new Map<string, typeof pending>();
      for (const a of pending) {
        const list = bySellerAdj.get(a.sellerId) ?? [];
        list.push(a);
        bySellerAdj.set(a.sellerId, list);
      }
      for (const entry of bySeller.values()) {
        const adjustments = bySellerAdj.get(entry.sellerId) ?? [];
        let available = entry.netAmount;
        let absorbed = 0;
        for (const a of adjustments) {
          const mag = Number(a.amount);
          if (round2(available - mag) < 0) break; // would go negative → carry forward
          available = round2(available - mag);
          absorbed = round2(absorbed + mag);
          entry.appliedAdjustmentIds.push(a.id);
        }
        entry.clawbackAdjustment = absorbed;
        entry.netAmount = round2(available);
      }
    }

    return [...bySeller.values()];
  }

  // ---------------------------------------------------------------------------
  // Create run
  // ---------------------------------------------------------------------------

  /**
   * Materialize a payout run per seller. Each seller is its own transaction so
   * one seller racing a concurrent run (P2002 on PayoutItem.sellerOrderId) or a
   * seller order that slipped out of PENDING skips just that seller.
   */
  async createPayoutRun(adminUserId: string, sellerId?: string) {
    const previews = await this.buildPreview(sellerId);
    const created: string[] = [];

    for (const p of previews) {
      if (p.items.length === 0) continue;
      // Skip a seller with nothing to pay AND nothing to record — but DO create a
      // (net-0) run when a clawback was absorbed, so the recovery is ledgered and
      // the PayoutAdjustment is marked APPLIED (P3-02).
      if (p.netAmount <= 0 && p.clawbackAdjustment <= 0) continue;

      const account = await this.prisma.sellerPayoutAccount.findFirst({
        where: { sellerId: p.sellerId, deletedAt: null },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      });

      try {
        const payout = await this.prisma.$transaction(async (tx) => {
          const row = await tx.payout.create({
            data: {
              sellerId: p.sellerId,
              status: PayoutStatus.PROCESSING,
              grossAmount: new Prisma.Decimal(p.grossAmount),
              refundAdjustment: new Prisma.Decimal(p.refundAdjustment),
              tcsAdjustment: new Prisma.Decimal(p.tcsAdjustment),
              clawbackAdjustment: new Prisma.Decimal(p.clawbackAdjustment),
              netAmount: new Prisma.Decimal(p.netAmount),
              currencyCode: p.currencyCode,
              createdById: adminUserId,
              accountType: account?.accountType ?? null,
              accountHolderName: account?.accountHolderName ?? null,
              accountNumberMasked: maskAccountNumber(account?.accountNumber),
              ifscCode: account?.ifscCode ?? null,
              upiId: account?.upiId ?? null,
            },
          });

          for (const it of p.items) {
            // Unique on sellerOrderId → a concurrent run throws P2002 here.
            await tx.payoutItem.create({
              data: {
                payoutId: row.id,
                sellerOrderId: it.sellerOrderId,
                amount: new Prisma.Decimal(it.amount),
                refundedAmount: new Prisma.Decimal(it.refundedAmount),
                tcsDeducted: new Prisma.Decimal(it.tcsDeducted),
              },
            });
            // Secondary guard: only flip an order still PENDING.
            const flip = await tx.sellerOrder.updateMany({
              where: {
                id: it.sellerOrderId,
                payoutStatus: PayoutStatus.PENDING,
              },
              data: { payoutStatus: PayoutStatus.PROCESSING },
            });
            if (flip.count === 0) {
              throw new PayoutRaceError(it.sellerOrderId);
            }
          }

          // Absorb the return clawbacks this run netted out — mark them APPLIED
          // and attach them to this payout. Guarded on status=PENDING so a racing
          // run can't double-apply (the loser marks nothing). Carried-forward
          // adjustments (not in appliedAdjustmentIds) stay PENDING (P3-02).
          if (p.appliedAdjustmentIds.length > 0) {
            const applied = await tx.payoutAdjustment.updateMany({
              where: {
                id: { in: p.appliedAdjustmentIds },
                status: 'PENDING',
              },
              data: {
                status: 'APPLIED',
                payoutId: row.id,
                appliedAt: new Date(),
              },
            });
            if (applied.count !== p.appliedAdjustmentIds.length) {
              // A concurrent run grabbed one of these clawbacks — bail so this
              // seller's payable is recomputed on a fresh run (avoids netting a
              // clawback that another payout already absorbed).
              throw new PayoutRaceError(p.sellerId);
            }
          }
          return row;
        });
        created.push(payout.id);

        // Best-effort audit of the settlement run, outside the per-seller tx —
        // record() never throws (P3-05).
        await this.audit?.record({
          action: 'payout.run',
          entityType: 'Payout',
          entityId: payout.id,
          actorUserId: adminUserId,
          before: null,
          after: {
            status: PayoutStatus.PROCESSING,
            sellerId: p.sellerId,
            netAmount: p.netAmount,
            tcsAdjustment: p.tcsAdjustment,
            itemCount: p.items.length,
          },
        });
      } catch (err) {
        if (
          err instanceof PayoutRaceError ||
          (err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002')
        ) {
          this.logger.warn(
            `Skipping payout for seller ${p.sellerId} — a seller order is already being settled (race).`,
          );
          continue;
        }
        // Hard failure materializing this seller's run — count it, then bubble.
        this.metrics?.recordPayoutRun('failed');
        throw err;
      }
    }

    return this.prisma.payout.findMany({
      where: { id: { in: created } },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---------------------------------------------------------------------------
  // Disburse / fail
  // ---------------------------------------------------------------------------

  /** Mark a PROCESSING payout PAID (manual bank/UPI transfer). Idempotent. */
  async markPayoutPaid(
    adminUserId: string,
    input: { payoutId: string; utr: string; providerRef?: string },
  ) {
    const payout = await this.prisma.payout.findUnique({
      where: { id: input.payoutId },
      include: { items: true, seller: true },
    });
    if (!payout) throw new NotFoundException('Payout not found.');
    if (payout.status === PayoutStatus.PAID) return payout; // idempotent
    if (payout.status !== PayoutStatus.PROCESSING) {
      throw new BadRequestException(
        `Only a PROCESSING payout can be marked paid (current: ${payout.status}).`,
      );
    }

    const now = new Date();
    const sellerOrderIds = payout.items.map((i) => i.sellerOrderId);

    await this.prisma.$transaction([
      this.prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: PayoutStatus.PAID,
          utr: input.utr,
          providerRef: input.providerRef ?? null,
          paidAt: now,
        },
      }),
      this.prisma.sellerOrder.updateMany({
        where: { id: { in: sellerOrderIds } },
        data: { payoutStatus: PayoutStatus.PAID },
      }),
    ]);

    // A payout run reached PAID (past the idempotent early-return, so counted
    // once per genuine transition). Side-effect-only.
    this.metrics?.recordPayoutRun('success');

    // Best-effort audit of the disbursement, outside the tx — never throws.
    await this.audit?.record({
      action: 'payout.mark_paid',
      entityType: 'Payout',
      entityId: payout.id,
      actorUserId: adminUserId,
      before: { status: PayoutStatus.PROCESSING },
      after: {
        status: PayoutStatus.PAID,
        utr: input.utr,
        netAmount: Number(payout.netAmount),
      },
    });

    // Notify the seller (soft-fail — the transfer already happened).
    if (payout.seller.businessEmail) {
      this.email
        .send('seller_payout_disbursed', payout.seller.businessEmail, {
          sellerName: payout.seller.displayName,
          payoutAmount: `₹${Number(payout.netAmount).toFixed(2)}`,
          periodLabel: periodLabel(payout.periodStart, payout.periodEnd, now),
        })
        .catch((err) =>
          this.logger.warn(
            `seller_payout_disbursed email failed for payout ${payout.id}: ${(err as Error).message}`,
          ),
        );
    }

    return this.prisma.payout.findUnique({
      where: { id: payout.id },
      include: { items: true },
    });
  }

  /**
   * Mark a PROCESSING payout FAILED: revert its seller orders to PENDING and
   * delete the items so a fresh run can pick them up again.
   */
  async markPayoutFailed(payoutId: string, reason: string) {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      include: { items: true },
    });
    if (!payout) throw new NotFoundException('Payout not found.');
    if (payout.status !== PayoutStatus.PROCESSING) {
      throw new BadRequestException(
        `Only a PROCESSING payout can be marked failed (current: ${payout.status}).`,
      );
    }

    const sellerOrderIds = payout.items.map((i) => i.sellerOrderId);

    await this.prisma.$transaction([
      this.prisma.sellerOrder.updateMany({
        where: { id: { in: sellerOrderIds } },
        data: { payoutStatus: PayoutStatus.PENDING },
      }),
      this.prisma.payoutItem.deleteMany({ where: { payoutId: payout.id } }),
      // Revert any RETURN_CLAWBACK adjustments this run absorbed back to PENDING
      // so they carry forward and net against the seller's NEXT payout. Without
      // this they stay APPLIED against a dead payout that disbursed nothing, and
      // buildPreview (which only nets PENDING) would silently drop them —
      // permanently overpaying the seller by the un-recovered commission.
      this.prisma.payoutAdjustment.updateMany({
        where: { payoutId: payout.id, status: PayoutAdjustmentStatus.APPLIED },
        data: {
          status: PayoutAdjustmentStatus.PENDING,
          payoutId: null,
          appliedAt: null,
        },
      }),
      this.prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: PayoutStatus.FAILED,
          failureReason: reason,
          failedAt: new Date(),
        },
      }),
    ]);

    // A payout run reached FAILED (past the PROCESSING-only guard, so counted
    // once per genuine transition). Side-effect-only.
    this.metrics?.recordPayoutRun('failed');

    // Best-effort audit of the failure, outside the tx — never throws (P3-05).
    await this.audit?.record({
      action: 'payout.mark_failed',
      entityType: 'Payout',
      entityId: payout.id,
      before: { status: PayoutStatus.PROCESSING },
      after: { status: PayoutStatus.FAILED, reason },
    });

    return this.prisma.payout.findUnique({ where: { id: payout.id } });
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async listPayouts(opts: {
    status?: PayoutStatus;
    sellerId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 10));
    const where: Prisma.PayoutWhereInput = {
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.sellerId ? { sellerId: opts.sellerId } : {}),
    };
    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.payout.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.payout.count({ where }),
    ]);
    return {
      items: rows,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      currentPage: page,
      pageSize,
    };
  }
}

/** Internal sentinel: a seller order left PENDING mid-run → skip the seller. */
class PayoutRaceError extends Error {
  constructor(sellerOrderId: string) {
    super(`Seller order ${sellerOrderId} is no longer PENDING for payout.`);
    this.name = 'PayoutRaceError';
  }
}

/** Mask all but the last 4 digits of a bank account number. */
function maskAccountNumber(acct?: string | null): string | null {
  if (!acct) return null;
  const last4 = acct.slice(-4);
  return `${'*'.repeat(Math.max(0, acct.length - 4))}${last4}`;
}

function periodLabel(
  start: Date | null,
  end: Date | null,
  fallback: Date,
): string {
  if (start && end) {
    return `${start.toLocaleDateString('en-IN')} – ${end.toLocaleDateString('en-IN')}`;
  }
  return fallback.toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
}
