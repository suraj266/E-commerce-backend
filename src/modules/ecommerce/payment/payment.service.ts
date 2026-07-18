/**
 * PaymentService — checkout orchestrator.
 *
 * Coordinates the two-phase checkout flow:
 *   1. initiateCheckout → create order + payment session
 *   2. verifyPayment / handleWebhook → confirm payment
 *
 * Uses the gateway strategy map to delegate to the correct gateway.
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
  PaymentGateway,
  PaymentMethod,
  PaymentStatus,
  PaymentTransactionStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { OrderPlacementService } from '../order/order-placement.service';
import { OrderService } from '../order/order.service';
import { PaymentConfigService } from './payment-config.service';
import {
  PAYMENT_GATEWAY_MAP,
  type IPaymentGateway,
} from './gateways/payment-gateway.interface';
import { InitiateCheckoutInput } from './dto/initiate-checkout.input';
import { VerifyPaymentInput } from './dto/verify-payment.input';
import { InvoiceService } from '../invoice/invoice.service';
import { paidAmountMatches, expectedPaise } from './payment-amount.util';
import { RefundService } from './refund.service';

/**
 * Thrown when a webhook fails signature verification. The controller maps this
 * to HTTP 401 (distinct from a transient 5xx) so a forged/misconfigured webhook
 * is rejected without ever marking an order paid.
 */
export class WebhookSignatureError extends Error {
  constructor(message = 'Invalid webhook signature.') {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

/** Only reconcile payments older than this — avoids racing an in-flight verify. */
const PAYMENT_RECONCILE_GRACE_MS = 10 * 60 * 1000; // 10 minutes

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly placement: OrderPlacementService,
    private readonly orderService: OrderService,
    private readonly configService: PaymentConfigService,
    @Inject(PAYMENT_GATEWAY_MAP)
    private readonly gatewayMap: Map<string, IPaymentGateway>,
    private readonly invoice: InvoiceService,
    private readonly refundService: RefundService,
  ) {}

  /**
   * Empties the buyer's cart after a PREPAID payment is captured. Prepaid
   * orders intentionally keep the cart until payment succeeds (so a cancelled
   * payment leaves it intact for retry — see order-placement step f), so we
   * clear it here. Fire-and-forget; a missed clear is a tolerable degradation.
   */
  private clearCartForOrder(orderId: string): void {
    this.prisma.order
      .findUnique({ where: { id: orderId }, select: { customerId: true } })
      .then((order) => {
        if (!order) return;
        return this.prisma.cart
          .findUnique({
            where: { customerId: order.customerId },
            select: { id: true },
          })
          .then((cart) => {
            if (!cart) return;
            return this.prisma.cartItem.deleteMany({
              where: { cartId: cart.id },
            });
          });
      })
      .catch((err) =>
        this.logger.warn(
          `Cart clear after payment for order ${orderId} failed: ${(err as Error).message}`,
        ),
      );
  }

  /**
   * Fire-and-forget invoice generation for every SellerOrder under an
   * Order. Called after a payment captures successfully (verify or
   * webhook path). Failures are logged but never block the payment ack
   * — the admin can regenerate via UI if a render fails.
   */
  private generateInvoicesForOrder(orderId: string): void {
    this.prisma.sellerOrder
      .findMany({ where: { orderId }, select: { id: true } })
      .then((sellerOrders) => {
        for (const so of sellerOrders) {
          this.invoice.generateForSellerOrder(so.id).catch((err) => {
            this.logger.error(
              `Invoice generation failed for seller-order ${so.id}: ${(err as Error).message}`,
            );
          });
        }
      })
      .catch((err) => {
        this.logger.error(
          `Could not list seller orders for ${orderId}: ${(err as Error).message}`,
        );
      });
  }

  /**
   * Single source of truth for "a capture succeeded": mark the Payment CAPTURED
   * and the Order + SellerOrders PAID in one transaction, then kick off invoice
   * generation and cart clearing. Shared by the verify path, the webhook path,
   * and the reconciliation cron so all three behave identically and idempotently
   * (callers must guard that the payment is not already CAPTURED before calling).
   */
  private async finalizeCapturedPayment(
    payment: { id: string; orderId: string },
    paymentUpdate: Prisma.PaymentUpdateInput,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentTransactionStatus.CAPTURED,
          capturedAt: new Date(),
          ...paymentUpdate,
        },
      }),
      this.prisma.order.update({
        where: { id: payment.orderId },
        data: { paymentStatus: PaymentStatus.PAID },
      }),
      this.prisma.sellerOrder.updateMany({
        where: { orderId: payment.orderId },
        data: { paymentStatus: PaymentStatus.PAID },
      }),
    ]);

    this.generateInvoicesForOrder(payment.orderId);
    this.clearCartForOrder(payment.orderId);
  }

  // ---------------------------------------------------------------------------
  // Customer-facing
  // ---------------------------------------------------------------------------

  /**
   * Phase 1: Create order + initiate payment session.
   *
   * For COD: order is created with paymentStatus=PENDING, returns immediately.
   * For online: order is created with paymentStatus=AWAITING_PAYMENT, a
   *   Payment record is created, and gateway payload is returned so the
   *   frontend can open the gateway SDK.
   */
  async initiateCheckout(userId: string, input: InitiateCheckoutInput) {
    const gatewayName = input.gateway;
    const gateway = this.gatewayMap.get(gatewayName);
    if (!gateway) {
      throw new BadRequestException(`Unknown payment gateway: ${gatewayName}`);
    }

    // Load config + decrypt credentials
    const config = await this.configService.getConfigForGateway(gatewayName);
    const credentials =
      await this.configService.getDecryptedCredentials(gatewayName);
    gateway.initialize(credentials);

    // Determine the payment method to record on the order
    const supportedMethods = Array.isArray(config.supportedMethods)
      ? (config.supportedMethods as string[])
      : [];
    const orderPaymentMethod: PaymentMethod =
      gatewayName === 'COD'
        ? PaymentMethod.COD
        : ((supportedMethods[0] as PaymentMethod) ?? PaymentMethod.CARD);

    // Determine payment status based on gateway type
    const isCod = gatewayName === 'COD';
    const paymentStatus: PaymentStatus = isCod
      ? PaymentStatus.PENDING
      : PaymentStatus.AWAITING_PAYMENT;

    // Create the order using existing placement service. `allowPrepaid: true`
    // authorises the non-COD status here (the raw placeOrder path is COD-only).
    // `clientRequestId` makes a retried checkout resolve to the same order
    // instead of creating a duplicate.
    const order = await this.placement.placeOrder(
      userId,
      {
        shippingAddressId: input.shippingAddressId,
        billingAddressId: input.billingAddressId,
        paymentMethod: orderPaymentMethod,
        customerNotes: input.customerNotes,
        couponCode: input.couponCode,
        buyerGstin: input.buyerGstin,
        clientRequestId: input.clientRequestId,
      },
      paymentStatus,
      { allowPrepaid: true },
    );

    // Calculate processing fee
    let processingFee = 0;
    if (Number(config.processingFee) > 0) {
      if (config.processingFeeType === 'PERCENTAGE') {
        processingFee =
          (Number(order.totalAmount) * Number(config.processingFee)) / 100;
      } else {
        processingFee = Number(config.processingFee);
      }
      processingFee = Math.round(processingFee * 100) / 100;
    }

    const totalWithFee = Number(order.totalAmount) + processingFee;
    const currency = order.currencyCode ?? 'INR';

    // Session reuse: if a retry lands here for an order that already has a live
    // (CREATED, unexpired) payment for the same gateway + amount, reuse that
    // session instead of opening a second one — otherwise two live gateway
    // orders could both be paid (double charge).
    let reusable = null as Awaited<
      ReturnType<typeof this.prisma.payment.findFirst>
    >;
    if (!isCod) {
      reusable = await this.prisma.payment.findFirst({
        where: {
          orderId: order.id,
          gateway: gatewayName,
          status: PaymentTransactionStatus.CREATED,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { createdAt: 'desc' },
      });
      if (reusable && Number(reusable.amount) !== totalWithFee) {
        // Amount changed since the previous attempt (e.g. cart/coupon edited) —
        // don't reuse a stale session.
        reusable = null;
      }
    }

    // Create payment session with gateway (reusing the prior gateway order id
    // when we found a reusable payment).
    const session = await gateway.createSession({
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount: totalWithFee,
      currency,
      method: orderPaymentMethod,
      description: `Order ${order.orderNumber}`,
      existingGatewayOrderId: reusable?.gatewayOrderId ?? undefined,
    });

    // Create the Payment record only when not reusing an existing one.
    if (!reusable) {
      await this.prisma.payment.create({
        data: {
          orderId: order.id,
          gateway: gatewayName,
          method: orderPaymentMethod,
          amount: totalWithFee,
          processingFee,
          currency,
          status: isCod
            ? PaymentTransactionStatus.CAPTURED
            : PaymentTransactionStatus.CREATED,
          gatewayOrderId: session.gatewayOrderId,
          expiresAt: session.expiresAt,
          ...(isCod ? { capturedAt: new Date() } : {}),
        },
      });
    }

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      gateway: gatewayName,
      gatewayPayload: isCod ? null : JSON.stringify(session.clientPayload),
      requiresPayment: !isCod,
    };
  }

  /**
   * Phase 2 (frontend): Verify payment after gateway SDK reports success.
   * Idempotent — safe to call even if the webhook already confirmed it.
   */
  async verifyPayment(userId: string, input: VerifyPaymentInput) {
    // Verify ownership
    const customerId = await this.getCustomerId(userId);
    const order = await this.prisma.order.findUnique({
      where: { id: input.orderId },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.customerId !== customerId) {
      throw new ForbiddenException('You do not own this order.');
    }

    // Find the payment record
    const payment = await this.prisma.payment.findFirst({
      where: { orderId: input.orderId },
      orderBy: { createdAt: 'desc' },
    });
    if (!payment) throw new NotFoundException('Payment record not found.');

    // Already captured — idempotent
    if (payment.status === PaymentTransactionStatus.CAPTURED) {
      return order;
    }

    // Load gateway + verify
    const gateway = this.gatewayMap.get(payment.gateway);
    if (!gateway) {
      throw new BadRequestException(`Unknown gateway: ${payment.gateway}`);
    }

    const credentials = await this.configService.getDecryptedCredentials(
      payment.gateway,
    );
    gateway.initialize(credentials);

    const isValid = await gateway.verifyPayment({
      gatewayOrderId: input.gatewayOrderId ?? payment.gatewayOrderId ?? '',
      gatewayPaymentId: input.gatewayPaymentId,
      gatewaySignature: input.gatewaySignature,
    });

    if (!isValid) {
      throw new BadRequestException('Payment verification failed.');
    }

    // Signature only proves the payment id is bound to the order id — it does
    // NOT prove the correct amount was paid. Fetch the authoritative captured
    // state from the gateway and fail closed on any mismatch (underpayment /
    // tampering / wrong currency / not actually captured).
    const fetched = await gateway.fetchPayment(input.gatewayPaymentId);
    if (fetched.status !== 'captured') {
      throw new BadRequestException(
        `Payment is not captured (gateway status: ${fetched.status}).`,
      );
    }
    if (
      payment.gatewayOrderId &&
      fetched.gatewayOrderId &&
      fetched.gatewayOrderId !== payment.gatewayOrderId
    ) {
      throw new BadRequestException('Payment does not belong to this order.');
    }
    if (!paidAmountMatches(fetched.amount, fetched.currency, payment)) {
      this.logger.error(
        `Amount mismatch on verify for order ${input.orderId}: gateway paid ${fetched.amount} ${fetched.currency}, expected ${expectedPaise(payment.amount)} ${payment.currency}`,
      );
      throw new BadRequestException('Payment amount mismatch.');
    }

    await this.finalizeCapturedPayment(payment, {
      gatewayPaymentId: input.gatewayPaymentId,
      gatewaySignature: input.gatewaySignature,
    });

    return this.prisma.order.findUnique({ where: { id: input.orderId } });
  }

  /**
   * Phase 2 (webhook): Handle gateway webhook event.
   * Called by PaymentWebhookController.
   */
  async handleWebhook(
    gatewayName: PaymentGateway,
    rawBody: Buffer,
    signature: string,

    parsedBody: any,
  ) {
    const gateway = this.gatewayMap.get(gatewayName);
    if (!gateway) return;

    const credentials =
      await this.configService.getDecryptedCredentials(gatewayName);
    gateway.initialize(credentials);

    if (!gateway.verifyWebhook(rawBody, signature)) {
      throw new WebhookSignatureError();
    }

    // Refund events (`refund.processed` / `refund.failed`) carry the refund
    // entity under payload.refund.entity — route those to the RefundService.
    const refundEntity = parsedBody?.payload?.refund?.entity;
    if (refundEntity) {
      await this.refundService.handleRefundWebhook(refundEntity);
      return;
    }

    // Razorpay sends event: "payment.captured" / "payment.failed"
    const event = parsedBody?.event;
    const payloadEntity = parsedBody?.payload?.payment?.entity;
    if (!payloadEntity) return;

    const gatewayOrderId = payloadEntity.order_id;
    const gatewayPaymentId = payloadEntity.id;

    const payment = await this.prisma.payment.findFirst({
      where: { gatewayOrderId },
    });
    if (!payment) return;

    // Already processed — idempotent
    if (
      payment.status === PaymentTransactionStatus.CAPTURED ||
      payment.status === PaymentTransactionStatus.FAILED
    ) {
      return;
    }

    if (event === 'payment.captured') {
      // Assert the captured amount/currency before marking PAID. On mismatch do
      // NOT mark the Payment FAILED — that would poison the idempotency guard
      // above and swallow a later legitimate webhook for the same order. Instead
      // leave the order AWAITING_PAYMENT and surface it for manual review.
      const capturedPaise = Number(payloadEntity.amount);
      const capturedCurrency = String(payloadEntity.currency ?? '');
      if (!paidAmountMatches(capturedPaise, capturedCurrency, payment)) {
        this.logger.error(
          `Webhook amount mismatch for order ${payment.orderId}: captured ${capturedPaise} ${capturedCurrency}, ` +
            `expected ${expectedPaise(payment.amount)} ${payment.currency}. Leaving order AWAITING_PAYMENT for manual review.`,
        );
        return;
      }

      await this.finalizeCapturedPayment(payment, {
        gatewayPaymentId,
        gatewayResponse: payloadEntity as unknown as Prisma.InputJsonValue,
      });
    } else if (event === 'payment.failed') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentTransactionStatus.FAILED,
          gatewayPaymentId,
          gatewayResponse: payloadEntity as unknown as Prisma.InputJsonValue,
          failedAt: new Date(),
        },
      });
      // A prepaid order whose payment failed must not linger as a
      // seller-actionable PENDING order. Cancel it (releasing reserved stock)
      // unless it's COD (no upfront payment) or already paid (race). The
      // cancel is idempotent, so a frontend cancelCheckout + this webhook
      // firing both is safe.
      await this.orderService
        .cancelForPaymentFailure(payment.orderId, 'Payment failed at gateway')
        .catch((err) =>
          this.logger.error(
            `Auto-cancel after payment.failed for order ${payment.orderId} failed: ${(err as Error).message}`,
          ),
        );
    }
  }

  /**
   * Reconciliation backstop (invoked by PaymentReconciliationCron). Even with a
   * working webhook, a missed/failed delivery or a lost verify call can leave an
   * order stuck AWAITING_PAYMENT while the money was actually captured. This
   * sweep recovers those:
   *   Sweep A — online orders still AWAITING_PAYMENT with a CREATED payment
   *             older than the grace window: ask the gateway whether the order
   *             was in fact captured (amount re-verified) and finalize it.
   *   Sweep B — PAID seller-orders whose tax invoice never generated: backfill.
   * Idempotent: re-running never double-marks PAID or double-generates invoices.
   */
  async reconcilePendingPayments(): Promise<{
    recovered: number;
    invoicesBackfilled: number;
  }> {
    const cutoff = new Date(Date.now() - PAYMENT_RECONCILE_GRACE_MS);
    const pending = await this.prisma.payment.findMany({
      where: {
        status: PaymentTransactionStatus.CREATED,
        gateway: { not: PaymentGateway.COD },
        createdAt: { lt: cutoff },
        order: { paymentStatus: PaymentStatus.AWAITING_PAYMENT },
      },
      take: 200,
    });

    let recovered = 0;
    for (const payment of pending) {
      try {
        const gateway = this.gatewayMap.get(payment.gateway);
        if (!gateway || !payment.gatewayOrderId) continue;

        const credentials = await this.configService.getDecryptedCredentials(
          payment.gateway,
        );
        gateway.initialize(credentials);

        const gwPayments = await gateway.fetchOrderPayments(
          payment.gatewayOrderId,
        );
        const captured = gwPayments.find((p) => p.status === 'captured');
        if (!captured) continue;

        if (!paidAmountMatches(captured.amount, captured.currency, payment)) {
          this.logger.error(
            `Reconcile amount mismatch for order ${payment.orderId} — skipping (manual review).`,
          );
          continue;
        }

        // Re-check status inside the loop in case a webhook/verify won the race.
        const fresh = await this.prisma.payment.findUnique({
          where: { id: payment.id },
          select: { status: true },
        });
        if (!fresh || fresh.status === PaymentTransactionStatus.CAPTURED)
          continue;

        await this.finalizeCapturedPayment(payment, {
          gatewayResponse: captured as unknown as Prisma.InputJsonValue,
        });
        recovered++;
        this.logger.warn(
          `Reconciled webhook-missed capture for order ${payment.orderId}.`,
        );
      } catch (err) {
        this.logger.warn(
          `Reconcile failed for payment ${payment.id}: ${(err as Error).message}`,
        );
      }
    }

    // Sweep B — PAID seller-orders missing a tax invoice.
    const missingInvoice = await this.prisma.sellerOrder.findMany({
      where: {
        paymentStatus: PaymentStatus.PAID,
        invoiceNumber: null,
        deletedAt: null,
      },
      select: { id: true },
      take: 200,
    });
    let invoicesBackfilled = 0;
    for (const so of missingInvoice) {
      try {
        await this.invoice.generateForSellerOrder(so.id);
        invoicesBackfilled++;
      } catch (err) {
        this.logger.warn(
          `Invoice backfill failed for seller-order ${so.id}: ${(err as Error).message}`,
        );
      }
    }

    return { recovered, invoicesBackfilled };
  }

  /**
   * Phase 2 (frontend): the customer dismissed the gateway modal without
   * paying. Cancels the prepaid order (releasing reserved stock) with the
   * reason "Payment cancelled by customer". Idempotent + race-safe: if the
   * payment was actually captured (webhook landed first) we DON'T cancel — we
   * return the order untouched so a paid order is never voided.
   */
  async cancelCheckout(userId: string, orderId: string) {
    const customerId = await this.getCustomerId(userId);
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.customerId !== customerId) {
      throw new ForbiddenException('You do not own this order.');
    }

    // Race guard: payment already captured → leave the order as-is.
    if (order.paymentStatus === PaymentStatus.PAID) {
      return order;
    }

    // Mark the latest payment attempt FAILED (PaymentTransactionStatus has no
    // CANCELLED value, so FAILED doubles for "customer dismissed").
    const payment = await this.prisma.payment.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
    if (payment && payment.status === PaymentTransactionStatus.CAPTURED) {
      // Captured between the dismiss and this call — don't cancel.
      return order;
    }
    if (payment && payment.status === PaymentTransactionStatus.CREATED) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentTransactionStatus.FAILED, failedAt: new Date() },
      });
    }

    await this.orderService.cancelForPaymentFailure(
      orderId,
      'Payment cancelled by customer',
    );
    return this.prisma.order.findUnique({ where: { id: orderId } });
  }

  // ---------------------------------------------------------------------------
  // Admin — Transactions
  // ---------------------------------------------------------------------------

  async listPayments(opts: {
    gateway?: PaymentGateway;
    status?: PaymentTransactionStatus;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 10));

    const where: Prisma.PaymentWhereInput = {
      ...(opts.gateway ? { gateway: opts.gateway } : {}),
      ...(opts.status ? { status: opts.status } : {}),
    };

    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({
        ...r,
        amount: Number(r.amount),
        processingFee: Number(r.processingFee),
      })),
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      currentPage: page,
      pageSize,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async getCustomerId(userId: string): Promise<string> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) {
      throw new ForbiddenException('Only customer accounts can checkout.');
    }
    return customer.id;
  }
}
