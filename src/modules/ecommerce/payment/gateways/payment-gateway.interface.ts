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
  /**
   * When set, reuse this existing gateway order id (from a prior checkout
   * attempt for the same order) instead of creating a new one — avoids
   * spawning a second live payment session on a retry.
   */
  existingGatewayOrderId?: string;
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

/** Authoritative payment state fetched directly from the gateway. */
export interface FetchedPayment {
  /** Captured amount in the gateway's minor unit (paise for INR). */
  amount: number;
  currency: string;
  /** Gateway status, e.g. 'captured' | 'authorized' | 'failed'. */
  status: string;
  /** Gateway order id this payment belongs to, when available. */
  gatewayOrderId?: string;
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

  /**
   * Fetch the authoritative captured state of a single payment from the
   * gateway. Used to assert the paid amount/currency before marking an order
   * PAID (defence against amount tampering / underpayment).
   */
  fetchPayment(gatewayPaymentId: string): Promise<FetchedPayment>;

  /**
   * Fetch all payments recorded against a gateway order id. Used by the
   * reconciliation cron to recover a capture whose webhook/verify was missed.
   */
  fetchOrderPayments(gatewayOrderId: string): Promise<FetchedPayment[]>;

  /** Issue a full or partial refund. */
  refund(input: RefundInput): Promise<RefundResult>;
}
