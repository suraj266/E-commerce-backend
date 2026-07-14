/**
 * Reconciliation backstop for payments whose webhook/verify was missed. The
 * Razorpay webhook (payment-webhook.controller.ts) is the primary confirmation
 * path; this cron catches the tail cases — a dropped webhook or a lost verify
 * call after the money was captured — so an order never stays stuck
 * AWAITING_PAYMENT with the customer already charged. Idempotent: applies the
 * same guarded finalize logic as the webhook, so re-running is safe.
 *
 * Modeled on CourierStatusCron (same in-process `running` guard pattern).
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PaymentService } from './payment.service';

@Injectable()
export class PaymentReconciliationCron {
  private readonly logger = new Logger(PaymentReconciliationCron.name);
  private running = false;

  constructor(private readonly payment: PaymentService) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async reconcile(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { recovered, invoicesBackfilled } =
        await this.payment.reconcilePendingPayments();
      if (recovered || invoicesBackfilled) {
        this.logger.log(
          `Payment reconciliation: recovered ${recovered} capture(s), backfilled ${invoicesBackfilled} invoice(s).`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Payment reconciliation run failed: ${(err as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }
}
