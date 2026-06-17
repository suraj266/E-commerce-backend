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
          .findUnique({ where: { customerId: order.customerId }, select: { id: true } })
          .then((cart) => {
            if (!cart) return;
            return this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
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
        : (supportedMethods[0] as PaymentMethod) ?? PaymentMethod.CARD;

    // Determine payment status based on gateway type
    const isCod = gatewayName === 'COD';
    const paymentStatus: PaymentStatus = isCod
      ? PaymentStatus.PENDING
      : PaymentStatus.AWAITING_PAYMENT;

    // Create the order using existing placement service
    const order = await this.placement.placeOrder(userId, {
      shippingAddressId: input.shippingAddressId,
      billingAddressId: input.billingAddressId,
      paymentMethod: orderPaymentMethod,
      customerNotes: input.customerNotes,
      couponCode: input.couponCode,
      buyerGstin: input.buyerGstin,
    }, paymentStatus);

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

    // Create payment session with gateway
    const session = await gateway.createSession({
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount: totalWithFee,
      currency: order.currencyCode ?? 'INR',
      method: orderPaymentMethod,
      description: `Order ${order.orderNumber}`,
    });

    // Create Payment record
    await this.prisma.payment.create({
      data: {
        orderId: order.id,
        gateway: gatewayName,
        method: orderPaymentMethod,
        amount: totalWithFee,
        processingFee,
        currency: order.currencyCode ?? 'INR',
        status: isCod
          ? PaymentTransactionStatus.CAPTURED
          : PaymentTransactionStatus.CREATED,
        gatewayOrderId: session.gatewayOrderId,
        expiresAt: session.expiresAt,
        ...(isCod ? { capturedAt: new Date() } : {}),
      },
    });

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

    // Update payment + order (+ sub-orders so the seller view reflects PAID)
    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentTransactionStatus.CAPTURED,
          gatewayPaymentId: input.gatewayPaymentId,
          gatewaySignature: input.gatewaySignature,
          capturedAt: new Date(),
        },
      }),
      this.prisma.order.update({
        where: { id: input.orderId },
        data: { paymentStatus: PaymentStatus.PAID },
      }),
      this.prisma.sellerOrder.updateMany({
        where: { orderId: input.orderId },
        data: { paymentStatus: PaymentStatus.PAID },
      }),
    ]);

    // Phase 1: payment captured → generate the tax invoice per
    // SellerOrder. Fire-and-forget; failures are logged but never
    // delay returning the success ack to the customer.
    this.generateInvoicesForOrder(input.orderId);
    // Prepaid cart is cleared on capture (not at placement).
    this.clearCartForOrder(input.orderId);

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parsedBody: any,
  ) {
    const gateway = this.gatewayMap.get(gatewayName);
    if (!gateway) return;

    const credentials =
      await this.configService.getDecryptedCredentials(gatewayName);
    gateway.initialize(credentials);

    if (!gateway.verifyWebhook(rawBody, signature)) {
      throw new BadRequestException('Invalid webhook signature.');
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
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentTransactionStatus.CAPTURED,
            gatewayPaymentId,
            gatewayResponse: payloadEntity as unknown as Prisma.InputJsonValue,
            capturedAt: new Date(),
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
