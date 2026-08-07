/**
 * RefundService — buyer-refund money-out rail (Phase 2, P2-01).
 *
 * Mirrors the safety model of PaymentService's capture path:
 *   - requestRefund   : ownership-checked, computes the over-refund ceiling,
 *                       creates a REQUESTED refund. No money moves.
 *   - approveRefund   : the money-mover. Persists PROCESSING BEFORE calling
 *                       gateway.refund(), then finalizes in ONE guarded
 *                       transaction (Refund/Payment/Order/SellerOrder +
 *                       OrderStatusHistory + movement-based restock).
 *   - rejectRefund    : admin declines a pending request.
 *   - handleRefundWebhook : async refund.processed / refund.failed, idempotent,
 *                       reuses the same guarded finalize so restock runs once.
 *
 * Idempotency guards:
 *   - `gatewayRefundId @unique` catches a double-approve at the DB.
 *   - the PROCESSED status flip is done with a conditional updateMany so only
 *     one racing caller (approve vs webhook) finalizes + emails.
 *   - restock is gated on the absence of prior `order_refund` movements for
 *     this refund, so inventory is returned exactly once.
 *
 * Payout coupling: refunds are blocked on any seller order already PROCESSING
 * or PAID for payout (clawback is a follow-on) — see assertNoPayoutInFlight.
 */

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  PaymentGateway,
  PaymentStatus,
  PaymentTransactionStatus,
  PayoutStatus,
  Prisma,
  RefundStatus,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { config } from '@/common/config/config';
import { computeParentStatus } from '../order/order.helpers';
import { PaymentConfigService } from './payment-config.service';
import {
  PAYMENT_GATEWAY_MAP,
  type IPaymentGateway,
} from './gateways/payment-gateway.interface';
import { RequestRefundInput } from './dto/request-refund.input';
import { CreateSellerRefundInput } from './dto/create-seller-refund.input';
import { OutboxService } from '@/modules/outbox/outbox.service';
import { OUTBOX_EVENT, OUTBOX_QUEUE } from '@/modules/outbox/outbox.constants';
import { AuditService } from '@/modules/observability/audit/audit.service';
import { TcsService } from '@/modules/compliance/tcs/tcs.service';
import { NotificationService } from '@/modules/notification/notification.service';
import { MetricsService } from '@/modules/observability/metrics/metrics.service';

/** Rounds to 2dp — money is Decimal(10,2); we compare in major units. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Best-effort message for anything a gateway SDK throws.
 *
 * Gateway SDKs reject with plain objects as often as with Errors (Razorpay
 * rejects with `{ statusCode, error: { description, code } }`), so reading
 * `.message` blindly stores the literal string "undefined" as the failure
 * reason — which is exactly the information an operator needs and can't get.
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === 'object') {
    const e = err as {
      error?: { description?: string; code?: string };
      message?: string;
    };
    if (e.error?.description) {
      return e.error.code
        ? `${e.error.description} [${e.error.code}]`
        : e.error.description;
    }
    if (e.message) return e.message;
    try {
      return JSON.stringify(err);
    } catch {
      /* fall through */
    }
  }
  return typeof err === 'string' && err ? err : 'Unknown gateway error.';
}

/** Small tolerance for float compares against a Decimal-derived total. */
const EPSILON = 0.01;

type SellerOrderLike = {
  id: string;
  storeId: string;
  status: OrderStatus;
  payoutStatus: PayoutStatus;
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  shippingAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  shippedAt: Date | null;
  orderNumber: string;
};

@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: PaymentConfigService,
    @Inject(PAYMENT_GATEWAY_MAP)
    private readonly gatewayMap: Map<string, IPaymentGateway>,
    private readonly email: EmailService,
    private readonly outbox: OutboxService,
    // Optional so existing unit tests that construct RefundService directly keep
    // compiling; the app always injects it (AuditModule is @Global). Audit
    // writes are best-effort — `record()` never throws — so a missing instance
    // (in a test) simply skips the trail. See P3-05.
    private readonly audit?: AuditService,
    // Optional trailing param (same reasoning; TcsModule is @Global). On a
    // finalized refund we write a NEGATIVE §52 TCS reversal row INSIDE the
    // finalize transaction — guarded with `?.`. See P3-03.
    private readonly tcs?: TcsService,
    // @Global NotificationService (P3-08). Optional trailing param (same
    // reasoning). Writes the buyer's in-app "refunded" bell entry alongside the
    // refund email — best-effort, guarded with `?.`. See P3-08.
    private readonly notifications?: NotificationService,
    // @Global MetricsService (P3-04). Optional trailing param (same reasoning).
    // Fire-and-forget business counter — a metrics hiccup can never fail a
    // refund. recordRefundProcessed('processed'|'failed') at the terminal points.
    private readonly metrics?: MetricsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Customer-facing
  // ---------------------------------------------------------------------------

  /**
   * Create a REQUESTED refund. Ownership-checked against the customer. Computes
   * `maxRefundable = payment.amount − Σ(PROCESSING|PROCESSED refunds)` and
   * rejects an over-refund. No money moves here.
   */
  async requestRefund(userId: string, input: RequestRefundInput) {
    const { order, sellerOrder } = await this.resolveScope(input);

    const customerId = await this.getCustomerId(userId);
    if (order.customerId !== customerId) {
      throw new ForbiddenException('You do not own this order.');
    }

    const payment = await this.getRefundablePayment(order.id);

    const scoped = sellerOrder
      ? [sellerOrder]
      : await this.prisma.sellerOrder.findMany({
          where: { orderId: order.id, deletedAt: null },
        });
    this.assertNoPayoutInFlight(scoped);

    const maxRefundable = await this.computeMaxRefundable(
      payment.id,
      Number(payment.amount),
    );
    if (maxRefundable <= 0) {
      throw new BadRequestException('This payment is already fully refunded.');
    }

    const scopeTotal = sellerOrder
      ? this.sellerOrderTotal(sellerOrder)
      : maxRefundable;
    const amount = round2(input.amount ?? Math.min(scopeTotal, maxRefundable));

    if (amount <= 0) {
      throw new BadRequestException('Refund amount must be greater than zero.');
    }
    if (amount > maxRefundable + EPSILON) {
      throw new BadRequestException(
        `Refund of ${amount} exceeds the refundable amount of ${round2(maxRefundable)}.`,
      );
    }

    return this.prisma.refund.create({
      data: {
        orderId: order.id,
        sellerOrderId: sellerOrder?.id ?? null,
        paymentId: payment.id,
        amount: new Prisma.Decimal(amount),
        reason: input.reason ?? null,
        restock: input.restock ?? false,
        status: RefundStatus.REQUESTED,
        requestedById: userId,
      },
    });
  }

  /** The customer's own refunds (most recent first). */
  async myRefunds(userId: string) {
    const customerId = await this.getCustomerId(userId);
    return this.prisma.refund.findMany({
      where: { order: { customerId } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---------------------------------------------------------------------------
  // Returns / RMA reuse (P3-02)
  // ---------------------------------------------------------------------------

  /**
   * Run the buyer refund for a QC-passed return against ONE seller-order slice.
   * The single reuse point for the returns flow — it does NOT re-implement the
   * money path: it creates a restock-enabled Refund and drives the existing
   * guarded, exactly-once `approveRefund` (which finalizes Payment/Order status,
   * gated restock, and the §52 TCS reversal). The payout-in-flight hard block is
   * skipped because returns recover an already-settled order via a
   * PayoutAdjustment clawback, not by refusing the refund.
   *
   * Prepaid → refunds immediately through the gateway. COD (or no gateway
   * payment id) → leaves the Refund REQUESTED for finance to disburse manually
   * (restock then runs when finance approves it).
   */
  async refundForReturn(input: {
    orderId: string;
    sellerOrderId: string;
    amount: number;
    reason?: string;
    requestedById?: string | null;
    approvedById?: string | null;
    /**
     * The originating ReturnRequest. The refund row is created AND linked back
     * onto ReturnRequest.refundId in ONE transaction, so this method is
     * idempotent per return: a resume (reconciliation cron re-driving a return
     * whose completion crashed) reuses the already-linked refund instead of
     * creating a second one — no double refund.
     */
    returnRequestId: string;
  }) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        orderId: input.orderId,
        status: PaymentTransactionStatus.CAPTURED,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!payment) {
      throw new BadRequestException(
        'No captured payment exists for this order to refund.',
      );
    }

    // Reuse the refund already reserved for this return, if any (idempotent
    // resume). Only create — and clamp against the refundable ceiling — the
    // FIRST time, when no refund is linked yet.
    const rr = await this.prisma.returnRequest.findUnique({
      where: { id: input.returnRequestId },
      select: { refundId: true },
    });
    let refundId = rr?.refundId ?? null;

    if (!refundId) {
      const maxRefundable = await this.computeMaxRefundable(
        payment.id,
        Number(payment.amount),
      );
      const amount = round2(Math.min(input.amount, maxRefundable));
      if (amount <= 0) {
        throw new BadRequestException('This payment is already fully refunded.');
      }
      // Create + link atomically BEFORE any gateway movement: if execution
      // crashes, the link survives and the resume reuses this same refund.
      const created = await this.prisma.$transaction(async (tx) => {
        const r = await tx.refund.create({
          data: {
            orderId: input.orderId,
            sellerOrderId: input.sellerOrderId,
            paymentId: payment.id,
            amount: new Prisma.Decimal(amount),
            reason: input.reason ?? 'Return / RMA',
            restock: true, // returned stock always comes back in
            status: RefundStatus.REQUESTED,
            requestedById: input.requestedById ?? null,
          },
        });
        await tx.returnRequest.update({
          where: { id: input.returnRequestId },
          data: { refundId: r.id },
        });
        return r;
      });
      refundId = created.id;
    }

    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
    });
    if (!refund) {
      throw new NotFoundException('Reserved return refund missing.');
    }

    // COD / no gateway payment id → manual disbursement; leave it REQUESTED.
    if (payment.gateway === PaymentGateway.COD || !payment.gatewayPaymentId) {
      return refund;
    }

    // Prepaid → guarded exactly-once gateway refund + restock + TCS reversal.
    // approveRefund is itself idempotent (an already-PROCESSED refund is returned
    // untouched), so re-driving a reused refund never double-charges the gateway.
    const finalized = await this.approveRefund(
      input.approvedById ?? input.requestedById ?? 'system',
      refund.id,
      { skipPayoutInFlightGuard: true },
    );
    return finalized ?? refund;
  }

  // ---------------------------------------------------------------------------
  // Seller-initiated cancellation refund
  // ---------------------------------------------------------------------------

  /**
   * Read-only assessment of what THIS seller may refund on THIS slice, plus the
   * reason when they may not. Shared by the preview query (renders the reason)
   * and the create mutation (throws on it), so the dialog can never offer an
   * action the mutation would reject.
   *
   * The ceiling is the MINIMUM of two independent limits:
   *   - payment remaining : captured amount − all PROCESSING/PROCESSED refunds
   *                         on the parent payment (the existing over-refund rail)
   *   - slice remaining   : this sub-order's own total − what's already been
   *                         refunded against it
   * The slice limit is what stops one seller in a multi-seller order from
   * refunding another seller's share of the same captured payment.
   */
  private async assessSellerRefund(
    so: {
      id: string;
      orderId: string;
      status: OrderStatus;
      payoutStatus: PayoutStatus;
      subtotal: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      shippingAmount: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
    },
    /**
     * Runs on the caller's transaction when there is one, so the re-check inside
     * `createSellerRefund`'s FOR UPDATE lock reads on the SAME connection that
     * holds the lock (rather than racing it from a second one).
     */
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const sliceTotal = this.sellerOrderTotal(so);

    const sliceAgg = await client.refund.aggregate({
      where: {
        sellerOrderId: so.id,
        status: { in: [RefundStatus.PROCESSING, RefundStatus.PROCESSED] },
      },
      _sum: { amount: true },
    });
    const alreadyRefunded = round2(Number(sliceAgg._sum.amount ?? 0));

    const payment = await client.payment.findFirst({
      where: {
        orderId: so.orderId,
        status: PaymentTransactionStatus.CAPTURED,
      },
      orderBy: { createdAt: 'desc' },
    });

    let paymentRemaining = 0;
    if (payment) {
      const paymentAgg = await client.refund.aggregate({
        where: {
          paymentId: payment.id,
          status: { in: [RefundStatus.PROCESSING, RefundStatus.PROCESSED] },
        },
        _sum: { amount: true },
      });
      paymentRemaining = round2(
        Number(payment.amount) - Number(paymentAgg._sum.amount ?? 0),
      );
    }
    const sliceRemaining = round2(sliceTotal - alreadyRefunded);
    const maxRefundable = Math.max(
      0,
      round2(Math.min(paymentRemaining, sliceRemaining)),
    );

    // First matching rule wins — ordered most-specific first so the seller sees
    // the actionable reason, not a generic one.
    let blockedReason: string | null = null;
    if (so.status !== OrderStatus.CANCELLED) {
      blockedReason =
        'Only a cancelled order can be refunded from here. Cancel the order first.';
    } else if (!payment) {
      blockedReason =
        'No captured payment exists for this order — there is nothing to refund.';
    } else if (
      payment.gateway === PaymentGateway.COD ||
      !payment.gatewayPaymentId
    ) {
      blockedReason =
        'This was a Cash-on-Delivery order — no online payment was taken, so there is nothing to refund.';
    } else if (
      so.payoutStatus === PayoutStatus.PROCESSING ||
      so.payoutStatus === PayoutStatus.PAID
    ) {
      blockedReason =
        'This order is already in a payout run or paid out. Contact support — the money has to be recovered as a clawback.';
    } else if (maxRefundable <= 0) {
      blockedReason = 'This order has already been fully refunded.';
    }

    return {
      payment,
      sliceTotal,
      alreadyRefunded,
      maxRefundable,
      blockedReason,
    };
  }

  /**
   * Everything the seller's refund dialog renders. Never throws for a
   * business-rule block — it returns `refundable: false` + `blockedReason`.
   * Ownership is still enforced hard (a seller cannot preview someone else's
   * order).
   */
  async getSellerRefundPreview(userId: string, sellerOrderId: string) {
    const so = await this.loadOwnedSellerOrder(userId, sellerOrderId);
    const assessment = await this.assessSellerRefund(so);

    const refunds = await this.prisma.refund.findMany({
      where: { sellerOrderId: so.id },
      orderBy: { createdAt: 'desc' },
    });

    return {
      sellerOrderId: so.id,
      orderNumber: so.orderNumber,
      currencyCode: so.currencyCode,
      subtotal: Number(so.subtotal),
      taxAmount: Number(so.taxAmount),
      shippingAmount: Number(so.shippingAmount),
      discountAmount: Number(so.discountAmount),
      sliceTotal: assessment.sliceTotal,
      alreadyRefunded: assessment.alreadyRefunded,
      maxRefundable: assessment.maxRefundable,
      refundable: assessment.blockedReason === null,
      blockedReason: assessment.blockedReason,
      paymentGateway: assessment.payment?.gateway ?? null,
      refunds,
    };
  }

  /**
   * Seller refunds the buyer for their own cancelled sub-order. This EXECUTES —
   * it creates the Refund and immediately drives the guarded `approveRefund`,
   * so the money leaves through the gateway in the same call. There is no admin
   * approval step by design; the seller is the one who cancelled.
   *
   * Two things make this safe to hand to a seller account:
   *   - the amount is capped at their OWN slice (see assessSellerRefund), so a
   *     seller can never refund another seller's share of a shared payment;
   *   - `restock: false` is forced. The cancel path already returned this
   *     slice's stock via `order_cancel` movements, and finalizeRefund's restock
   *     gate only looks for prior `order_refund` movements — so a restocking
   *     refund here would return the same units to inventory TWICE.
   *
   * Concurrency: the ceiling re-check and the Refund insert run inside one
   * transaction behind a `FOR UPDATE` lock on the sub-order row (same pattern as
   * returns.service.ts / invoice.service.ts), so two rapid clicks can't each
   * pass a stale ceiling check and over-refund the slice.
   */
  async createSellerRefund(userId: string, input: CreateSellerRefundInput) {
    const so = await this.loadOwnedSellerOrder(userId, input.sellerOrderId);

    const refund = await this.prisma.$transaction(async (tx) => {
      // Serialise concurrent refund creation on this slice.
      await tx.$queryRaw`SELECT id FROM "SellerOrder" WHERE id = ${so.id} FOR UPDATE`;

      // Re-assess INSIDE the lock — the numbers may have moved since the dialog
      // was opened (another refund, a payout run starting).
      const { payment, maxRefundable, blockedReason } =
        await this.assessSellerRefund(so, tx);
      if (blockedReason) throw new BadRequestException(blockedReason);
      // Narrowing only — assessSellerRefund already blocks on a missing payment.
      if (!payment) {
        throw new BadRequestException(
          'No captured payment exists for this order to refund.',
        );
      }

      const amount = round2(input.amount ?? maxRefundable);
      if (amount <= 0) {
        throw new BadRequestException(
          'Refund amount must be greater than zero.',
        );
      }
      if (amount > maxRefundable + EPSILON) {
        throw new BadRequestException(
          `Refund of ${amount} exceeds the refundable amount of ${maxRefundable} for this order.`,
        );
      }

      return tx.refund.create({
        data: {
          orderId: so.orderId,
          sellerOrderId: so.id,
          paymentId: payment.id,
          amount: new Prisma.Decimal(amount),
          reason: input.reason?.trim() || 'Order cancelled by seller',
          restock: false, // cancel already restocked — see the doc block above
          status: RefundStatus.REQUESTED,
          requestedById: userId,
        },
      });
    });

    // Trail the seller's decision separately from the generic approve trail, so
    // an audit can tell a seller-driven refund from a finance-driven one.
    await this.audit?.record({
      action: 'refund.seller_initiated',
      entityType: 'Refund',
      entityId: refund.id,
      actorUserId: userId,
      before: { sellerOrderId: so.id, sellerOrderStatus: so.status },
      after: { amount: Number(refund.amount), reason: refund.reason },
    });

    // Execute. approveRefund is the single money path — PROCESSING before the
    // gateway call, guarded exactly-once finalize (payment/order status, §52 TCS
    // reversal, durable buyer email + bell), idempotent on re-entry.
    const finalized = await this.approveRefund(userId, refund.id);
    return finalized ?? refund;
  }

  // ---------------------------------------------------------------------------
  // Admin — money movers
  // ---------------------------------------------------------------------------

  /**
   * Approve + execute a refund. Persists PROCESSING before the gateway call,
   * then finalizes (Payment/Order/SellerOrder/restock) in one transaction.
   * Idempotent: an already-PROCESSED refund is returned untouched.
   */
  async approveRefund(
    adminUserId: string,
    refundId: string,
    opts?: { skipPayoutInFlightGuard?: boolean },
  ) {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: { payment: true },
    });
    if (!refund) throw new NotFoundException('Refund not found.');

    const priorStatus = refund.status; // captured for the audit before/after
    if (refund.status === RefundStatus.PROCESSED) return refund; // idempotent
    if (
      refund.status !== RefundStatus.REQUESTED &&
      refund.status !== RefundStatus.PROCESSING
    ) {
      throw new BadRequestException(
        `Refund cannot be approved from status ${refund.status}.`,
      );
    }

    const payment = refund.payment;
    if (payment.gateway === PaymentGateway.COD || !payment.gatewayPaymentId) {
      throw new BadRequestException(
        'This payment cannot be refunded through a gateway (COD / no gateway payment id).',
      );
    }

    // Re-assert the over-refund ceiling at approve time (defends against two
    // pending requests each approved in turn).
    const otherRefunded = await this.sumRefunds(
      payment.id,
      [RefundStatus.PROCESSING, RefundStatus.PROCESSED],
      refund.id,
    );
    if (otherRefunded + Number(refund.amount) > Number(payment.amount) + EPSILON) {
      throw new BadRequestException(
        'Approving this refund would exceed the captured payment amount.',
      );
    }

    // Payout coupling guard. A return-driven refund (P3-02) passes
    // skipPayoutInFlightGuard: an already-settled seller order is NOT blocked —
    // the money is recovered via a PayoutAdjustment clawback instead of the
    // Phase-2 hard block.
    const scoped = await this.scopedSellerOrders(
      refund.orderId,
      refund.sellerOrderId,
    );
    if (!opts?.skipPayoutInFlightGuard) this.assertNoPayoutInFlight(scoped);

    // Persist PROCESSING BEFORE the gateway call so a crash mid-flight is
    // recoverable (the webhook / a retry can still finalize it).
    await this.prisma.refund.update({
      where: { id: refund.id },
      data: { status: RefundStatus.PROCESSING, approvedById: adminUserId },
    });

    // Load gateway + decrypt credentials — mirrors verifyPayment.
    const gateway = this.gatewayMap.get(payment.gateway);
    if (!gateway) {
      throw new BadRequestException(`Unknown gateway: ${payment.gateway}`);
    }
    const credentials = await this.configService.getDecryptedCredentials(
      payment.gateway,
    );
    gateway.initialize(credentials);

    let result: { refundId: string; status: string };
    try {
      result = await gateway.refund({
        gatewayPaymentId: payment.gatewayPaymentId,
        amount: Number(refund.amount),
        reason: refund.reason ?? undefined,
      });
    } catch (err) {
      const reason = errorMessage(err);
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: RefundStatus.FAILED,
          failureReason: reason.slice(0, 500),
        },
      });
      this.logger.error(
        `Gateway refund failed for refund ${refund.id} (order ${refund.orderId}): ${reason}`,
      );
      this.metrics?.recordRefundProcessed('failed');
      throw new BadRequestException(`Gateway refund failed: ${reason}`);
    }

    // Persist the gatewayRefundId immediately so an async webhook can correlate
    // (and the @unique guard blocks any second successful refund).
    await this.prisma.refund.update({
      where: { id: refund.id },
      data: {
        gatewayRefundId: result.refundId,
        gatewayResponse: result as unknown as Prisma.InputJsonValue,
      },
    });

    // Razorpay refund status is 'pending' | 'processed' | 'failed'. Only a
    // 'processed' result finalizes now; 'pending' waits for refund.processed.
    if (result.status === 'processed' || result.status === 'full') {
      await this.finalizeRefund(refund.id, {
        gatewayResponse: result as unknown as Prisma.InputJsonValue,
      });
    }

    const finalRefund = await this.prisma.refund.findUnique({
      where: { id: refund.id },
    });

    // Best-effort audit of the approve action, OUTSIDE the money assertions —
    // record() never throws (P3-05).
    await this.audit?.record({
      action: 'refund.approve',
      entityType: 'Refund',
      entityId: refund.id,
      actorUserId: adminUserId,
      before: { status: priorStatus, amount: Number(refund.amount) },
      after: {
        status: finalRefund?.status ?? RefundStatus.PROCESSING,
        gatewayRefundId: result.refundId,
      },
    });

    return finalRefund;
  }

  /** Decline a still-REQUESTED refund. */
  async rejectRefund(adminUserId: string, refundId: string, reason?: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
    });
    if (!refund) throw new NotFoundException('Refund not found.');
    if (refund.status !== RefundStatus.REQUESTED) {
      throw new BadRequestException(
        `Only a REQUESTED refund can be rejected (current: ${refund.status}).`,
      );
    }
    const updated = await this.prisma.refund.update({
      where: { id: refundId },
      data: {
        status: RefundStatus.REJECTED,
        approvedById: adminUserId,
        failureReason: reason ?? null,
      },
    });

    // Best-effort audit — outside the state change, never throws (P3-05).
    await this.audit?.record({
      action: 'refund.reject',
      entityType: 'Refund',
      entityId: refundId,
      actorUserId: adminUserId,
      before: { status: RefundStatus.REQUESTED },
      after: { status: RefundStatus.REJECTED, reason: reason ?? null },
    });

    return updated;
  }

  /**
   * Finalize a manual (COD / no-gateway) refund that finance has disbursed by
   * hand — the money loop a COD RETURN refund was missing. There is no gateway
   * to call: finance transfers the money out-of-band, then records the UTR/bank
   * reference here. Runs the SAME guarded finalize side effects the prepaid path
   * runs — quantity-aware return-restock, §52 TCS reversal, Payment/Order status,
   * and the durable buyer refund email/bell — via finalizeRefund.
   *
   * Idempotent: an already-PROCESSED refund is returned untouched, and the
   * PROCESSED flip inside finalizeRefund is a conditional winner-elect so a
   * re-run applies the side effects (restock/TCS/email) exactly once.
   *
   * Gateway-backed refunds are rejected here — they must go through approveRefund
   * so the gateway actually moves the money.
   */
  async disburseManualRefund(
    adminUserId: string,
    refundId: string,
    reference: string,
    note?: string,
  ) {
    const trimmedRef = (reference ?? '').trim();
    if (!trimmedRef) {
      throw new BadRequestException(
        'A payment reference (UTR / transaction id) is required to record a manual disbursement.',
      );
    }

    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: { payment: true },
    });
    if (!refund) throw new NotFoundException('Refund not found.');

    const priorStatus = refund.status;
    if (refund.status === RefundStatus.PROCESSED) return refund; // idempotent
    if (
      refund.status !== RefundStatus.REQUESTED &&
      refund.status !== RefundStatus.PROCESSING
    ) {
      throw new BadRequestException(
        `Refund cannot be disbursed from status ${refund.status}.`,
      );
    }

    // Manual disbursement is ONLY for COD / no-gateway refunds. A gateway-backed
    // refund must move real money through approveRefund, not be marked paid here.
    const payment = refund.payment;
    const isManual =
      payment.gateway === PaymentGateway.COD || !payment.gatewayPaymentId;
    if (!isManual) {
      throw new BadRequestException(
        'This refund is gateway-backed — approve it through the gateway instead of recording a manual disbursement.',
      );
    }

    // Re-assert the over-refund ceiling (defends against two manual disbursements
    // each recorded in turn against the same captured payment).
    const otherRefunded = await this.sumRefunds(
      payment.id,
      [RefundStatus.PROCESSING, RefundStatus.PROCESSED],
      refund.id,
    );
    if (otherRefunded + Number(refund.amount) > Number(payment.amount) + EPSILON) {
      throw new BadRequestException(
        'Recording this disbursement would exceed the captured payment amount.',
      );
    }

    // Preserve the manual reference on the refund BEFORE finalize so it survives
    // even if the finalize transaction is retried. The manual marker lets the
    // admin surface distinguish a hand-paid COD refund from a gateway one.
    const manualResponse = {
      manual: true,
      reference: trimmedRef,
      note: note ?? null,
      disbursedById: adminUserId,
      disbursedAt: new Date().toISOString(),
    } as unknown as Prisma.InputJsonValue;

    await this.prisma.refund.update({
      where: { id: refund.id },
      data: { approvedById: adminUserId, gatewayResponse: manualResponse },
    });

    // Same guarded finalize as the prepaid path: PROCESSED flip (winner-elect) +
    // Payment/Order status + gated return-aware restock + §52 TCS reversal +
    // durable buyer refund email. recordRefundProcessed fires inside on success.
    await this.finalizeRefund(refund.id, { gatewayResponse: manualResponse });

    const finalRefund = await this.prisma.refund.findUnique({
      where: { id: refund.id },
    });

    await this.audit?.record({
      action: 'refund.disburse_manual',
      entityType: 'Refund',
      entityId: refund.id,
      actorUserId: adminUserId,
      before: { status: priorStatus, amount: Number(refund.amount) },
      after: {
        status: finalRefund?.status ?? RefundStatus.PROCESSED,
        reference: trimmedRef,
      },
    });

    return finalRefund;
  }

  // ---------------------------------------------------------------------------
  // Webhook (async gateway confirmation)
  // ---------------------------------------------------------------------------

  /**
   * Handle a Razorpay `refund.processed` / `refund.failed` webhook entity.
   * Idempotent + gated so restock happens exactly once. Correlates by
   * `gatewayRefundId`; if the refund row isn't found (webhook raced ahead of
   * the approve transaction persisting the id) we no-op — the approve path
   * finalizes it, and Razorpay retries the webhook anyway.
   */
  async handleRefundWebhook(entity: {
    id?: string;
    status?: string;
    [k: string]: unknown;
  }): Promise<void> {
    const gatewayRefundId = entity?.id;
    if (!gatewayRefundId) return;

    const refund = await this.prisma.refund.findUnique({
      where: { gatewayRefundId },
    });
    if (!refund) {
      this.logger.warn(
        `Refund webhook for unknown gatewayRefundId ${gatewayRefundId} — ignoring (will retry).`,
      );
      return;
    }

    // Terminal — idempotent.
    if (
      refund.status === RefundStatus.PROCESSED ||
      refund.status === RefundStatus.FAILED
    ) {
      return;
    }

    if (entity.status === 'processed') {
      await this.finalizeRefund(refund.id, {
        gatewayResponse: entity as unknown as Prisma.InputJsonValue,
      });
    } else if (entity.status === 'failed') {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: RefundStatus.FAILED,
          failureReason: 'Gateway reported refund failed.',
          gatewayResponse: entity as unknown as Prisma.InputJsonValue,
        },
      });
      this.metrics?.recordRefundProcessed('failed');
      this.logger.error(
        `Refund ${refund.id} (order ${refund.orderId}) failed at gateway.`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Core finalize — the one guarded transaction
  // ---------------------------------------------------------------------------

  /**
   * Move a PROCESSING/REQUESTED refund to PROCESSED and apply all side effects
   * in ONE transaction: Payment status, Order/SellerOrder status +
   * OrderStatusHistory, and gated movement-based restock. The PROCESSED flip
   * is a conditional updateMany so only one racing caller (approve vs webhook)
   * runs the side effects + email.
   */
  private async finalizeRefund(
    refundId: string,
    opts?: { gatewayResponse?: Prisma.InputJsonValue },
  ): Promise<void> {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: {
        payment: true,
        order: {
          include: {
            sellerOrders: { where: { deletedAt: null } },
            customer: { include: { user: true } },
          },
        },
      },
    });
    if (!refund) return;
    if (refund.status === RefundStatus.PROCESSED) return;

    const scoped: SellerOrderLike[] = refund.sellerOrderId
      ? refund.order.sellerOrders.filter((so) => so.id === refund.sellerOrderId)
      : refund.order.sellerOrders;

    let didFinalize = false;

    await this.prisma.$transaction(async (tx) => {
      // Race-safe PROCESSED flip.
      const flip = await tx.refund.updateMany({
        where: { id: refund.id, status: { not: RefundStatus.PROCESSED } },
        data: {
          status: RefundStatus.PROCESSED,
          ...(opts?.gatewayResponse
            ? { gatewayResponse: opts.gatewayResponse }
            : {}),
        },
      });
      if (flip.count === 0) return; // another caller already finalized
      didFinalize = true;

      const now = new Date();

      // Payment-level total refunded (this refund is now PROCESSED).
      const agg = await tx.refund.aggregate({
        where: { paymentId: refund.paymentId, status: RefundStatus.PROCESSED },
        _sum: { amount: true },
      });
      const totalRefunded = Number(agg._sum.amount ?? 0);
      const paymentFull =
        totalRefunded >= Number(refund.payment.amount) - EPSILON;

      const paymentTxnStatus = paymentFull
        ? PaymentTransactionStatus.REFUNDED
        : PaymentTransactionStatus.PARTIALLY_REFUNDED;
      const orderPayStatus = paymentFull
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED;

      await tx.payment.update({
        where: { id: refund.paymentId },
        data: { status: paymentTxnStatus, refundedAt: now },
      });

      // Per-seller-order status + payment status.
      for (const so of scoped) {
        const soTotal = this.sellerOrderTotal(so);
        let soFull = paymentFull;
        if (!soFull) {
          const soAgg = await tx.refund.aggregate({
            where: { sellerOrderId: so.id, status: RefundStatus.PROCESSED },
            _sum: { amount: true },
          });
          soFull = Number(soAgg._sum.amount ?? 0) >= soTotal - EPSILON;
        }

        const soData: Prisma.SellerOrderUpdateInput = {
          paymentStatus: soFull
            ? PaymentStatus.REFUNDED
            : PaymentStatus.PARTIALLY_REFUNDED,
        };
        const statusChanges =
          soFull &&
          so.status !== OrderStatus.REFUNDED &&
          so.status !== OrderStatus.CANCELLED;
        if (statusChanges) soData.status = OrderStatus.REFUNDED;

        await tx.sellerOrder.update({ where: { id: so.id }, data: soData });

        if (statusChanges) {
          await tx.orderStatusHistory.create({
            data: {
              sellerOrderId: so.id,
              fromStatus: so.status,
              toStatus: OrderStatus.REFUNDED,
              changedById: refund.approvedById ?? null,
              notes: `Refund of ${round2(Number(refund.amount))} processed`,
            },
          });
        }
      }

      // Roll up the parent order status from its (possibly updated) slices.
      const siblings = await tx.sellerOrder.findMany({
        where: { orderId: refund.orderId, deletedAt: null },
        select: { status: true },
      });
      const newParent = computeParentStatus(siblings.map((s) => s.status));
      if (newParent !== refund.order.status) {
        await tx.order.update({
          where: { id: refund.orderId },
          data: { status: newParent, paymentStatus: orderPayStatus },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId: refund.orderId,
            fromStatus: refund.order.status,
            toStatus: newParent,
            changedById: refund.approvedById ?? null,
            notes: `Refund of ${round2(Number(refund.amount))} processed`,
          },
        });
      } else {
        await tx.order.update({
          where: { id: refund.orderId },
          data: { paymentStatus: orderPayStatus },
        });
      }

      // Gated restock.
      if (refund.restock) {
        await this.restock(tx, refund.id, refund.orderId, refund.approvedById, scoped);
      }

      // Durable outbox: the customer refund email is enqueued INSIDE this tx so
      // it commits atomically with the PROCESSED flip — it can no longer be
      // dropped by a crash after the money moved. The email worker re-reads the
      // refund by id and sends. Only reached when we won the flip (didFinalize).
      await this.outbox.enqueue(tx, {
        type: OUTBOX_EVENT.EMAIL_ORDER_REFUNDED,
        queue: OUTBOX_QUEUE.EMAILS,
        payload: { refundId: refund.id },
        dedupeKey: `email:order_refunded:${refund.id}`,
      });

      // §52 TCS reversal (P3-03): write a NEGATIVE reversal row per affected
      // seller order, proportional to the refunded share, INSIDE this finalize
      // transaction so it commits atomically with the money-out. Idempotent
      // (partial-unique on (sellerOrderId, refundId) WHERE kind='REVERSAL').
      // Only reached when we won the PROCESSED flip (didFinalize).
      await this.tcs?.reverse(
        tx,
        {
          id: refund.id,
          amount: refund.amount,
          sellerOrderId: refund.sellerOrderId,
        },
        scoped,
      );
    });

    if (!didFinalize) return;

    // P3-04 business counter — exactly one increment per refund (only the caller
    // that won the PROCESSED flip reaches here). Fire-and-forget, never throws.
    this.metrics?.recordRefundProcessed('processed');

    // Best-effort audit of the PROCESSED transition, AFTER the guarded tx
    // committed — record() never throws (P3-05). Only the caller that won the
    // race (didFinalize) reaches here, so the trail has exactly one row.
    await this.audit?.record({
      action: 'refund.processed',
      entityType: 'Refund',
      entityId: refund.id,
      actorUserId: refund.approvedById ?? null,
      before: { status: RefundStatus.PROCESSING },
      after: { status: RefundStatus.PROCESSED, amount: Number(refund.amount) },
    });
  }

  /**
   * Send the `order_refunded` customer email. Invoked by the outbox email worker
   * for an `email.order_refunded` event; re-reads the refund by id. Throws on a
   * genuine send failure so the outbox retries; skips cleanly when the send is
   * intentionally SKIPPED or there's no recipient.
   */
  async sendOrderRefundedEmail(refundId: string): Promise<void> {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: {
        order: { include: { customer: { include: { user: true } } } },
      },
    });
    if (!refund) return;

    // In-app bell entry for the buyer, created BEFORE the send (both idempotent).
    const buyerUserId = refund.order.customer?.userId ?? null;
    if (buyerUserId) {
      await this.notifications?.create({
        userId: buyerUserId,
        type: 'order_refunded',
        title: 'Refund processed',
        body: `A refund of ₹${round2(Number(refund.amount)).toFixed(
          2,
        )} for order ${refund.order.orderNumber} has been processed.`,
        data: {
          refundId: refund.id,
          orderId: refund.orderId,
          orderNumber: refund.order.orderNumber,
          amount: Number(refund.amount),
          link: `/account/orders/${refund.orderId}`,
        },
        dedupeKey: `notif:order_refunded:${refund.id}`,
      });
    }

    const customerEmail = refund.order.customer?.user?.email;
    if (!customerEmail) return;

    const result = await this.email.send('order_refunded', customerEmail, {
      customerName: refund.order.customer.user.name ?? 'there',
      orderNumber: refund.order.orderNumber,
      refundAmount: `₹${round2(Number(refund.amount)).toFixed(2)}`,
      orderLink: `${config.FRONTEND_URL ?? ''}/account/orders/${refund.orderId}`,
    });
    if (!result.sent && !result.skipped) {
      throw new Error(`order_refunded email failed: ${result.message}`);
    }
  }

  /**
   * Return refunded lines to inventory by reversing the placement deductions,
   * writing `order_refund` movements. Gated on the absence of prior
   * `order_refund` movements for this refund so it runs exactly once.
   *
   * A shipped/delivered slice already had its reservation released and onHand
   * debited (see seller-order.service.ts), so its reversal restores
   * quantityAvailable + quantityOnHand. A not-yet-shipped slice still holds the
   * reservation, so its reversal restores quantityAvailable and releases
   * quantityReserved — matching the cancel path.
   */
  private async restock(
    tx: Prisma.TransactionClient,
    refundId: string,
    orderId: string,
    approvedById: string | null,
    scoped: SellerOrderLike[],
  ): Promise<void> {
    const already = await tx.inventoryMovement.count({
      where: { referenceType: 'order_refund', referenceId: refundId },
    });
    if (already > 0) return;

    // If this refund settles a RETURN, restock only the RETURNED quantity per
    // variant — a partial-quantity/partial-item return must NOT restore the whole
    // order (that would over-restock and let the seller oversell). A cancellation
    // / whole-order refund has no linked return → caps stays null → full restore.
    const ret = await tx.returnRequest.findFirst({
      where: { refundId },
      select: { items: { select: { orderItemId: true, quantity: true } } },
    });
    let caps: Map<string, number> | null = null;
    if (ret) {
      const oiIds = ret.items.map((i) => i.orderItemId);
      const ois = await tx.orderItem.findMany({
        where: { id: { in: oiIds } },
        select: { id: true, variantId: true },
      });
      const variantByOi = new Map(ois.map((o) => [o.id, o.variantId]));
      caps = new Map();
      for (const it of ret.items) {
        const vid = variantByOi.get(it.orderItemId);
        if (!vid) continue;
        caps.set(vid, (caps.get(vid) ?? 0) + it.quantity);
      }
    }

    for (const so of scoped) {
      const items = await tx.orderItem.findMany({
        where: { sellerOrderId: so.id },
        select: { variantId: true },
      });
      const variantIds = items.map((i) => i.variantId);
      if (variantIds.length === 0) continue;

      const shipped =
        so.shippedAt != null ||
        so.status === OrderStatus.DELIVERED ||
        (await tx.inventoryMovement.count({
          where: { referenceType: 'order_ship', referenceId: so.id },
        })) > 0;

      // Scope by the seller's own warehouses so a shared variant sold by
      // another seller isn't restocked here (mirrors ship/cancel scoping).
      const movements = await tx.inventoryMovement.findMany({
        where: {
          referenceType: 'order',
          referenceId: orderId,
          variantId: { in: variantIds },
          warehouse: { storeId: so.storeId },
        },
        orderBy: { inventoryId: 'asc' },
      });

      for (const m of movements) {
        let restore = Math.abs(m.quantityChange);
        if (caps) {
          // Return path: restore at most the returned quantity for this variant,
          // consuming the cap across the variant's (possibly multiple) movements.
          const remaining = caps.get(m.variantId) ?? 0;
          if (remaining <= 0) continue; // variant not returned → don't restock
          restore = Math.min(restore, remaining);
          caps.set(m.variantId, remaining - restore);
        }
        const inv = await tx.inventory.update({
          where: { id: m.inventoryId },
          data: shipped
            ? {
                quantityAvailable: { increment: restore },
                quantityOnHand: { increment: restore },
              }
            : {
                quantityAvailable: { increment: restore },
                quantityReserved: { decrement: restore },
              },
        });
        await tx.inventoryMovement.create({
          data: {
            inventoryId: m.inventoryId,
            variantId: m.variantId,
            warehouseId: m.warehouseId,
            movementType: 'return',
            quantityChange: restore,
            quantityBefore: inv.quantityAvailable - restore,
            quantityAfter: inv.quantityAvailable,
            referenceType: 'order_refund',
            referenceId: refundId,
            createdById: approvedById,
            notes: `Refund restock for ${so.orderNumber}`,
          },
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Admin reads
  // ---------------------------------------------------------------------------

  async listRefunds(opts: {
    status?: RefundStatus;
    orderId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 10));
    const where: Prisma.RefundWhereInput = {
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.orderId ? { orderId: opts.orderId } : {}),
    };
    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.refund.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.refund.count({ where }),
    ]);
    return {
      items: rows,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      currentPage: page,
      pageSize,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async resolveScope(input: RequestRefundInput) {
    if (input.sellerOrderId) {
      const sellerOrder = await this.prisma.sellerOrder.findUnique({
        where: { id: input.sellerOrderId },
        include: { order: true },
      });
      if (!sellerOrder || sellerOrder.deletedAt) {
        throw new NotFoundException('Seller order not found.');
      }
      return { order: sellerOrder.order, sellerOrder };
    }
    if (input.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: input.orderId },
      });
      if (!order || order.deletedAt) {
        throw new NotFoundException('Order not found.');
      }
      return { order, sellerOrder: null as null };
    }
    throw new BadRequestException(
      'Provide either orderId or sellerOrderId to refund.',
    );
  }

  private async getRefundablePayment(orderId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { orderId, status: PaymentTransactionStatus.CAPTURED },
      orderBy: { createdAt: 'desc' },
    });
    if (!payment) {
      throw new BadRequestException(
        'No captured payment exists for this order to refund.',
      );
    }
    if (payment.gateway === PaymentGateway.COD || !payment.gatewayPaymentId) {
      throw new BadRequestException(
        'COD orders are refunded manually — no gateway refund is possible.',
      );
    }
    return payment;
  }

  private async computeMaxRefundable(
    paymentId: string,
    paymentAmount: number,
  ): Promise<number> {
    const already = await this.sumRefunds(paymentId, [
      RefundStatus.PROCESSING,
      RefundStatus.PROCESSED,
    ]);
    return round2(paymentAmount - already);
  }

  private async sumRefunds(
    paymentId: string,
    statuses: RefundStatus[],
    excludeRefundId?: string,
  ): Promise<number> {
    const agg = await this.prisma.refund.aggregate({
      where: {
        paymentId,
        status: { in: statuses },
        ...(excludeRefundId ? { id: { not: excludeRefundId } } : {}),
      },
      _sum: { amount: true },
    });
    return Number(agg._sum.amount ?? 0);
  }

  private async scopedSellerOrders(
    orderId: string,
    sellerOrderId: string | null,
  ) {
    return this.prisma.sellerOrder.findMany({
      where: {
        orderId,
        deletedAt: null,
        ...(sellerOrderId ? { id: sellerOrderId } : {}),
      },
    });
  }

  private assertNoPayoutInFlight(
    sellerOrders: { payoutStatus: PayoutStatus }[],
  ): void {
    const blocked = sellerOrders.some(
      (so) =>
        so.payoutStatus === PayoutStatus.PROCESSING ||
        so.payoutStatus === PayoutStatus.PAID,
    );
    if (blocked) {
      throw new BadRequestException(
        'Cannot refund a seller order that is already in a payout run or paid out. A clawback must be handled by finance.',
      );
    }
  }

  private sellerOrderTotal(so: {
    subtotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    shippingAmount: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
  }): number {
    return round2(
      Number(so.subtotal) +
        Number(so.taxAmount) +
        Number(so.shippingAmount) -
        Number(so.discountAmount),
    );
  }

  /**
   * Load a sub-order the caller actually owns as a seller. Both failure modes
   * are hard: a non-seller account and someone else's order.
   */
  private async loadOwnedSellerOrder(userId: string, sellerOrderId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!seller) {
      throw new ForbiddenException('Only seller accounts can refund an order.');
    }
    const so = await this.prisma.sellerOrder.findUnique({
      where: { id: sellerOrderId },
    });
    if (!so || so.deletedAt) {
      throw new NotFoundException('Seller order not found.');
    }
    if (so.sellerId !== seller.id) {
      throw new ForbiddenException('You do not own this order.');
    }
    return so;
  }

  private async getCustomerId(userId: string): Promise<string> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) {
      throw new ForbiddenException('Only customer accounts can request refunds.');
    }
    return customer.id;
  }
}
