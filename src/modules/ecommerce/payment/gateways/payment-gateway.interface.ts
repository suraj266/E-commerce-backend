/**
 * IPaymentGateway — Strategy interface for payment gateways.
 *
 * Each gateway (COD, Razorpay, Stripe, etc.) implements this contract.
 * The PaymentService selects the correct implementation at runtime
 * based on the customer's chosen payment method.
 *
 * Mirrors the IImageProvider pattern used in the Image module.
 */

import { PaymentMethod } from '@prisma/client';

/** DI token for the gateway Map<string, IPaymentGateway>. */
export const PAYMENT_GATEWAY_MAP = 'PAYMENT_GATEWAY_MAP';

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface CreateSessionInput {
  orderId: string;
  orderNumber: string;
  /** Amount in major currency units (rupees, not paise). */
  amount: number;
  currency: string;
  method: PaymentMethod;
  customerEmail?: string;
  customerPhone?: string;
  customerName?: string;
  description?: string;
}

export interface PaymentSessionResult {
  /** Gateway-side order/session ID (e.g. Razorpay order_xxx). */
  gatewayOrderId: string;
  /** Payload the frontend needs to open the gateway SDK. */
  clientPayload: Record<string, unknown>;
  /** When this session expires (null = no expiry). */
  expiresAt?: Date | null;
}

export interface VerifyPaymentInput {
  gatewayOrderId: string;
  gatewayPaymentId: string;
  gatewaySignature: string;
}

export interface RefundInput {
  gatewayPaymentId: string;
  /** Amount in major currency units. */
  amount: number;
  reason?: string;
}

export interface RefundResult {
  refundId: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Strategy interface
// ---------------------------------------------------------------------------

export interface IPaymentGateway {
  /** Gateway identifier — matches the PaymentGateway enum value. */
  readonly name: string;

  /**
   * Initialize the gateway with decrypted credentials from the database.
   * Called before every createSession/refund to inject the current keys.
   */
  initialize(credentials: Record<string, unknown>): void;

  /** Create a payment session / order with the external gateway. */
  createSession(input: CreateSessionInput): Promise<PaymentSessionResult>;

  /** Verify a payment completion using the gateway's signature scheme. */
  verifyPayment(input: VerifyPaymentInput): Promise<boolean>;

  /** Verify an incoming webhook's authenticity via its signature header. */
  verifyWebhook(rawBody: Buffer, signature: string): boolean;

  /** Issue a full or partial refund. */
  refund(input: RefundInput): Promise<RefundResult>;
}
