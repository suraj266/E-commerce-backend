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
  PayoutStatus,
  Prisma,
  RefundStatus,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface PreviewItem {
  sellerOrderId: string;
  orderNumber: string;
  amount: number;
  refundedAmount: number;
}

export interface Preview {
  sellerId: string;
  sellerName: string;
  itemCount: number;
  grossAmount: number;
  refundAdjustment: number;
  netAmount: number;
  currencyCode: string;
  items: PreviewItem[];
}

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
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

    const bySeller = new Map<string, Preview>();
    for (const so of sellerOrders) {
      const gross = Number(so.payoutAmount);
      const refunded = Math.min(refundBySo.get(so.id) ?? 0, gross);
      const net = round2(gross - refunded);
      if (net <= 0) continue; // fully clawed back by refunds — nothing to pay

      let entry = bySeller.get(so.sellerId);
      if (!entry) {
        entry = {
          sellerId: so.sellerId,
          sellerName: so.seller.displayName,
          itemCount: 0,
          grossAmount: 0,
          refundAdjustment: 0,
          netAmount: 0,
          currencyCode: so.currencyCode,
          items: [],
        };
        bySeller.set(so.sellerId, entry);
      }
      entry.itemCount += 1;
      entry.grossAmount = round2(entry.grossAmount + gross);
      entry.refundAdjustment = round2(entry.refundAdjustment + refunded);
      entry.netAmount = round2(entry.netAmount + net);
      entry.items.push({
        sellerOrderId: so.id,
        orderNumber: so.orderNumber,
        amount: round2(net),
        refundedAmount: round2(refunded),
      });
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
      if (p.netAmount <= 0 || p.items.length === 0) continue;

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
          return row;
        });
        created.push(payout.id);
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
      this.prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: PayoutStatus.FAILED,
          failureReason: reason,
          failedAt: new Date(),
        },
      }),
    ]);

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
