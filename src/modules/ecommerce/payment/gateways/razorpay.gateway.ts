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
import { timingSafeEqualStr } from '@/common/crypto/timing-safe.util';
import type {
  IPaymentGateway,
  CreateSessionInput,
  PaymentSessionResult,
  VerifyPaymentInput,
  RefundInput,
  RefundResult,
  FetchedPayment,
} from './payment-gateway.interface';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Razorpay = require('razorpay');

@Injectable()
export class RazorpayGateway implements IPaymentGateway {
  readonly name = 'RAZORPAY';

  private keyId = '';
  private keySecret = '';
  private webhookSecret = '';

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

  async createSession(
    input: CreateSessionInput,
  ): Promise<PaymentSessionResult> {
    if (!this.client) {
      throw new BadRequestException('Razorpay gateway not initialized.');
    }

    // Razorpay expects amount in paise (smallest unit).
    const amountInPaise = Math.round(input.amount * 100);

    // On a retry, reuse the previously-created Razorpay order instead of
    // spawning a second live session for the same internal order.
    const order = input.existingGatewayOrderId
      ? { id: input.existingGatewayOrderId }
      : await this.client.orders.create({
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

    // Constant-time compare — a plain === leaks the signature byte by byte.
    return timingSafeEqualStr(expectedSignature, input.gatewaySignature);
  }

  verifyWebhook(rawBody: Buffer, signature: string): boolean {
    if (!this.webhookSecret) return false;

    const expectedSignature = createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    return timingSafeEqualStr(expectedSignature, signature);
  }

  async fetchPayment(gatewayPaymentId: string): Promise<FetchedPayment> {
    if (!this.client) {
      throw new BadRequestException('Razorpay gateway not initialized.');
    }
    const p = await this.client.payments.fetch(gatewayPaymentId);
    return {
      amount: Number(p.amount), // paise
      currency: p.currency,
      status: p.status, // 'captured' | 'authorized' | 'failed' | ...
      gatewayOrderId: p.order_id,
    };
  }

  async fetchOrderPayments(gatewayOrderId: string): Promise<FetchedPayment[]> {
    if (!this.client) {
      throw new BadRequestException('Razorpay gateway not initialized.');
    }
    const res = await this.client.orders.fetchPayments(gatewayOrderId);

    const items: any[] = res?.items ?? [];
    return items.map((p) => ({
      amount: Number(p.amount),
      currency: p.currency,
      status: p.status,
      gatewayOrderId: p.order_id,
    }));
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    if (!this.client) {
      throw new BadRequestException('Razorpay gateway not initialized.');
    }

    const amountInPaise = Math.round(input.amount * 100);
    try {
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
    } catch (err) {
      // The SDK rejects with a PLAIN OBJECT ({ statusCode, error: {...} }), not
      // an Error — so a caller reading `.message` gets `undefined` and the real
      // reason ("payment already refunded", "amount exceeds", bad key) is lost.
      // Normalise it to a real Error here, at the boundary that knows the shape.
      throw new Error(describeRazorpayError(err));
    }
  }
}

/**
 * Turn whatever the Razorpay SDK rejected with into a human sentence.
 * Handles the documented error envelope, a genuine Error, and anything else.
 */
export function describeRazorpayError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as {
      error?: {
        description?: string;
        code?: string;
        reason?: string;
        field?: string;
        source?: string;
        step?: string;
      };
      statusCode?: number;
      message?: string;
    };
    const inner = e.error;
    if (inner?.description) {
      const code = inner.code ? ` [${inner.code}]` : '';
      const reason =
        inner.reason && inner.reason !== 'NA' ? ` (${inner.reason})` : '';
      // Razorpay's generic "invalid request sent" is useless on its own; these
      // three fields are what actually identify the offending parameter.
      const detail = [
        inner.field ? `field=${inner.field}` : null,
        inner.source && inner.source !== 'NA' ? `source=${inner.source}` : null,
        inner.step && inner.step !== 'NA' ? `step=${inner.step}` : null,
      ]
        .filter(Boolean)
        .join(', ');
      return `${inner.description}${reason}${code}${detail ? ` — ${detail}` : ''}`;
    }
    if (e.message) return e.message;
    if (e.statusCode) return `Razorpay returned HTTP ${e.statusCode}.`;
    try {
      return JSON.stringify(err);
    } catch {
      /* fall through to the generic message below */
    }
  }
  return typeof err === 'string' && err
    ? err
    : 'Razorpay rejected the request without a description.';
}
