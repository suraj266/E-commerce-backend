/**
 * CodGateway — Cash on Delivery "gateway" implementation.
 *
 * COD requires no external API calls, no credentials, and no webhooks.
 * Every method is a no-op or returns a trivially successful result.
 * Payment is confirmed on physical delivery, not at checkout time.
 */

import { Injectable } from '@nestjs/common';
import type {
  IPaymentGateway,
  CreateSessionInput,
  PaymentSessionResult,
  VerifyPaymentInput,
  RefundInput,
  RefundResult,
  FetchedPayment,
} from './payment-gateway.interface';

@Injectable()
export class CodGateway implements IPaymentGateway {
  readonly name = 'COD';

  // COD has no credentials — no-op.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  initialize(_credentials: Record<string, unknown>): void {
    // nothing to do
  }

  async createSession(
    input: CreateSessionInput,
  ): Promise<PaymentSessionResult> {
    // COD doesn't create an external session. The "gatewayOrderId" is just
    // the internal order ID so the Payment row has something to reference.
    return {
      gatewayOrderId: `cod_${input.orderId}`,
      clientPayload: {}, // frontend doesn't need anything
      expiresAt: null,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async verifyPayment(_input: VerifyPaymentInput): Promise<boolean> {
    // COD is always "verified" at checkout — actual money arrives on delivery.
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  verifyWebhook(_rawBody: Buffer, _signature: string): boolean {
    return true;
  }

  // COD never reaches an amount-verification path (it is CAPTURED at checkout
  // and verifyPayment early-returns on CAPTURED). These exist only to satisfy
  // the interface; calling them is a programming error.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async fetchPayment(_gatewayPaymentId: string): Promise<FetchedPayment> {
    throw new Error('fetchPayment is not supported for COD.');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async fetchOrderPayments(_gatewayOrderId: string): Promise<FetchedPayment[]> {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async refund(_input: RefundInput): Promise<RefundResult> {
    // COD refunds are handled manually — no gateway API to call.
    return { refundId: 'cod_manual', status: 'manual' };
  }
}
