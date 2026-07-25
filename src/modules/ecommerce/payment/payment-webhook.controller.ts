/**
 * PaymentWebhookController — REST endpoints for gateway webhooks.
 *
 * Webhooks are HTTP POST (not GraphQL) and come from external services,
 * so there's no JWT auth. Security is via signature verification in the
 * gateway implementation.
 */

import { Controller, Post, Headers, Req, Res, Logger } from '@nestjs/common';
import { PaymentGateway } from '@prisma/client';
import { PaymentService, WebhookSignatureError } from './payment.service';
import { MetricsService } from '@/modules/observability/metrics/metrics.service';

const RAZORPAY_PROVIDER = 'razorpay';

@Controller('webhooks')
export class PaymentWebhookController {
  private readonly logger = new Logger(PaymentWebhookController.name);

  constructor(
    private readonly paymentService: PaymentService,
    // Optional trailing param (MetricsModule is @Global). Counters are
    // side-effect-only and guarded with `?.` — never affect the response.
    private readonly metrics?: MetricsService,
  ) {}

  /**
   * POST /webhooks/razorpay
   *
   * Razorpay sends events like `payment.captured`, `payment.failed` etc.
   * The signature is in the `x-razorpay-signature` header.
   *
   * Fail-closed status semantics:
   *   - missing raw body / invalid signature → 4xx (never mark paid)
   *   - unexpected/transient error           → 5xx (Razorpay retries)
   *   - success or terminal duplicate        → 200
   */
  @Post('razorpay')
  async razorpayWebhook(
    @Req() req: any,

    @Res() res: any,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    this.metrics?.recordWebhookReceived(RAZORPAY_PROVIDER);
    // req.rawBody is populated when rawBody:true in bootstrap. If it's missing
    // the HMAC cannot be verified over the exact signed bytes — fail closed
    // rather than re-serialising the parsed body (which never byte-matches).
    if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
      this.logger.error(
        'Razorpay webhook received without a raw body — rejecting.',
      );
      this.metrics?.recordWebhookFailed(RAZORPAY_PROVIDER);
      return res
        .status(400)
        .json({ status: 'error', message: 'raw body unavailable' });
    }

    try {
      await this.paymentService.handleWebhook(
        PaymentGateway.RAZORPAY,
        req.rawBody,
        signature ?? '',
        req.body,
      );
      return res.status(200).json({ status: 'ok' });
    } catch (error) {
      this.metrics?.recordWebhookFailed(RAZORPAY_PROVIDER);
      if (error instanceof WebhookSignatureError) {
        this.logger.warn(
          `Razorpay webhook signature rejected: ${error.message}`,
        );
        return res
          .status(401)
          .json({ status: 'error', message: 'invalid signature' });
      }
      // Transient/unexpected failure — return 5xx so Razorpay retries with backoff.
      this.logger.error(
        `Razorpay webhook processing failed: ${(error as Error).message}`,
      );
      return res
        .status(500)
        .json({ status: 'error', message: 'processing failed' });
    }
  }

  /**
   * POST /webhooks/stripe — placeholder for future Stripe integration.
   */
  @Post('stripe')
  async stripeWebhook(@Res() res: any) {
    return res.status(200).json({ status: 'not_implemented' });
  }
}
