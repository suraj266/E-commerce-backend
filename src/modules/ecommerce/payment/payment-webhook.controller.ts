/**
 * PaymentWebhookController — REST endpoints for gateway webhooks.
 *
 * Webhooks are HTTP POST (not GraphQL) and come from external services,
 * so there's no JWT auth. Security is via signature verification in the
 * gateway implementation.
 */

import {
  Controller,
  Post,
  Headers,
  Req,
  Res,
  HttpCode,
} from '@nestjs/common';
import { PaymentGateway } from '@prisma/client';
import { PaymentService } from './payment.service';

@Controller('webhooks')
export class PaymentWebhookController {
  constructor(private readonly paymentService: PaymentService) {}

  /**
   * POST /webhooks/razorpay
   *
   * Razorpay sends events like `payment.captured`, `payment.failed` etc.
   * The signature is in the `x-razorpay-signature` header.
   */
  @Post('razorpay')
  @HttpCode(200)
  async razorpayWebhook(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Req() req: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Res() res: any,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    try {
      // req.rawBody is available when rawBody: true in NestJS bootstrap.
      const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body));

      await this.paymentService.handleWebhook(
        PaymentGateway.RAZORPAY,
        rawBody,
        signature ?? '',
        req.body,
      );
      return res.json({ status: 'ok' });
    } catch (error) {
      // Always return 200 to Razorpay to avoid retries for known errors.
      console.error('[Razorpay Webhook Error]', error);
      return res.json({ status: 'error', message: (error as Error).message });
    }
  }

  /**
   * POST /webhooks/stripe — placeholder for future Stripe integration.
   */
  @Post('stripe')
  @HttpCode(200)
  async stripeWebhook(@Res() res: any) {
    return res.json({ status: 'not_implemented' });
  }
}
