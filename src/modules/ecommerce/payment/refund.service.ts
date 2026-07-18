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

/** Rounds to 2dp — money is Decimal(10,2); we compare in major units. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
  // Admin — money movers
  // ---------------------------------------------------------------------------

  /**
   * Approve + execute a refund. Persists PROCESSING before the gateway call,
   * then finalizes (Payment/Order/SellerOrder/restock) in one transaction.
   * Idempotent: an already-PROCESSED refund is returned untouched.
   */
  async approveRefund(adminUserId: string, refundId: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: { payment: true },
    });
    if (!refund) throw new NotFoundException('Refund not found.');

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

    // Payout coupling guard.
    const scoped = await this.scopedSellerOrders(
      refund.orderId,
      refund.sellerOrderId,
    );
    this.assertNoPayoutInFlight(scoped);

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
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: RefundStatus.FAILED,
          failureReason: (err as Error).message?.slice(0, 500),
        },
      });
      this.logger.error(
        `Gateway refund failed for refund ${refund.id} (order ${refund.orderId}): ${(err as Error).message}`,
      );
      throw new BadRequestException(
        `Gateway refund failed: ${(err as Error).message}`,
      );
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

    return this.prisma.refund.findUnique({ where: { id: refund.id } });
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
    return this.prisma.refund.update({
      where: { id: refundId },
      data: {
        status: RefundStatus.REJECTED,
        approvedById: adminUserId,
        failureReason: reason ?? null,
      },
    });
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
    });

    if (!didFinalize) return;

    // Fire the customer refund email (soft-fail — the money already moved).
    const customerEmail = refund.order.customer?.user?.email;
    if (customerEmail) {
      this.email
        .send('order_refunded', customerEmail, {
          customerName: refund.order.customer.user.name ?? 'there',
          orderNumber: refund.order.orderNumber,
          refundAmount: `₹${round2(Number(refund.amount)).toFixed(2)}`,
          orderLink: `${config.FRONTEND_URL ?? ''}/account/orders/${refund.orderId}`,
        })
        .catch((err) =>
          this.logger.warn(
            `order_refunded email failed for ${refund.orderId}: ${(err as Error).message}`,
          ),
        );
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
        const restore = Math.abs(m.quantityChange);
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
