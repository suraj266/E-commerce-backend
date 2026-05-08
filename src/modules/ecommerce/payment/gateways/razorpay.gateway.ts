/**
 * RazorpayGateway — Razorpay payment gateway implementation.
 *
 * Handles: CARD, UPI, NET_BANKING, WALLET via Razorpay's unified checkout.
 *
 * Flow:
 *   1. initialize() — receives decrypted { keyId, keySecret, webhookSecret }
 *   2. createSession() — calls razorpay.orders.create() to get an order ID
 *   3. verifyPayment() — HMAC SHA256 signature verification
 *   4. verifyWebhook() — validates x-razorpay-signature header
 *   5. refund() — calls razorpay.payments.refund()
 *
 * The `razorpay` npm package is used as the SDK.
 */

import { Injectable, BadRequestException } from '@nestjs/common';
import { createHmac } from 'crypto';
import type {
  IPaymentGateway,
  CreateSessionInput,
  PaymentSessionResult,
  VerifyPaymentInput,
  RefundInput,
  RefundResult,
} from './payment-gateway.interface';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Razorpay = require('razorpay');

@Injectable()
export class RazorpayGateway implements IPaymentGateway {
  readonly name = 'RAZORPAY';

  private keyId = '';
  private keySecret = '';
  private webhookSecret = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;

  initialize(credentials: Record<string, unknown>): void {
    this.keyId = (credentials.keyId as string) ?? '';
    this.keySecret = (credentials.keySecret as string) ?? '';
    this.webhookSecret = (credentials.webhookSecret as string) ?? '';

    if (!this.keyId || !this.keySecret) {
      throw new BadRequestException(
        'Razorpay credentials (keyId, keySecret) are not configured.',
      );
    }

    this.client = new Razorpay({
      key_id: this.keyId,
      key_secret: this.keySecret,
    });
  }

  async createSession(input: CreateSessionInput): Promise<PaymentSessionResult> {
    if (!this.client) {
      throw new BadRequestException('Razorpay gateway not initialized.');
    }

    // Razorpay expects amount in paise (smallest unit).
    const amountInPaise = Math.round(input.amount * 100);

    const order = await this.client.orders.create({
      amount: amountInPaise,
      currency: input.currency || 'INR',
      receipt: input.orderNumber,
      notes: {
        orderId: input.orderId,
        orderNumber: input.orderNumber,
      },
    });

    return {
      gatewayOrderId: order.id,
      clientPayload: {
        razorpayOrderId: order.id,
        razorpayKeyId: this.keyId,
        amount: amountInPaise,
        currency: input.currency || 'INR',
        name: input.description ?? 'Order Payment',
        prefill: {
          ...(input.customerEmail ? { email: input.customerEmail } : {}),
          ...(input.customerPhone ? { contact: input.customerPhone } : {}),
          ...(input.customerName ? { name: input.customerName } : {}),
        },
      },
      expiresAt: null, // Razorpay orders don't expire by default
    };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<boolean> {
    // Razorpay verification: HMAC SHA256 of "orderId|paymentId" with key_secret
    const expectedSignature = createHmac('sha256', this.keySecret)
      .update(`${input.gatewayOrderId}|${input.gatewayPaymentId}`)
      .digest('hex');

    return expectedSignature === input.gatewaySignature;
  }

  verifyWebhook(rawBody: Buffer, signature: string): boolean {
    if (!this.webhookSecret) return false;

    const expectedSignature = createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    return expectedSignature === signature;
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    if (!this.client) {
      throw new BadRequestException('Razorpay gateway not initialized.');
    }

    const amountInPaise = Math.round(input.amount * 100);
    const refund = await this.client.payments.refund(input.gatewayPaymentId, {
      amount: amountInPaise,
      notes: {
        reason: input.reason ?? 'Customer refund',
      },
    });

    return {
      refundId: refund.id,
      status: refund.status,
    };
  }
}
