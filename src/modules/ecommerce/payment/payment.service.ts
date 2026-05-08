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
import { PaymentConfigService } from './payment-config.service';
import {
  PAYMENT_GATEWAY_MAP,
  type IPaymentGateway,
} from './gateways/payment-gateway.interface';
import { InitiateCheckoutInput } from './dto/initiate-checkout.input';
import { VerifyPaymentInput } from './dto/verify-payment.input';

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly placement: OrderPlacementService,
    private readonly configService: PaymentConfigService,
    @Inject(PAYMENT_GATEWAY_MAP)
    private readonly gatewayMap: Map<string, IPaymentGateway>,
  ) {}

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

    // Update payment + order
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
    ]);

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
      ]);
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
    }
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
