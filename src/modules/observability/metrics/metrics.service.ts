/**
 * P3-04 — MetricsService: the thin, injectable surface domain code calls to
 * record business events.
 *
 * The HTTP interceptor, Prisma timing extension, and outbox gauge collector
 * give real coverage with ZERO domain-code changes on day one. The counters
 * below are the manual hooks for the money path. Because P3-03 owns the money
 * services this wave (payment/refund/payout), the actual `metrics.record*()`
 * call sites are deferred — see the "WIRE-METRICS" notes in the P3-04 report.
 *
 * Every method is a fire-and-forget increment on a prom-client singleton and
 * never throws, so a metrics hiccup can never fail a business transaction.
 */

import { Injectable } from '@nestjs/common';
import {
  invoicesGeneratedTotal,
  paymentTransactionsTotal,
  payoutRunsTotal,
  refundsProcessedTotal,
  webhookFailedTotal,
  webhookReceivedTotal,
} from './metrics.registry';

export type PaymentMethod = 'prepaid' | 'cod';

@Injectable()
export class MetricsService {
  /** Prepaid capture committed / COD confirmed, or a finalisation failure. */
  recordPayment(result: 'success' | 'failure', method: PaymentMethod): void {
    paymentTransactionsTotal.labels(result, method).inc();
  }

  /** A gateway/courier webhook was received (before verification/processing). */
  recordWebhookReceived(provider: string): void {
    webhookReceivedTotal.labels(provider).inc();
  }

  /** A webhook failed signature verification or downstream processing. */
  recordWebhookFailed(provider: string): void {
    webhookFailedTotal.labels(provider).inc();
  }

  /** A tax invoice was generated (invoice worker / reconciliation backfill). */
  recordInvoiceGenerated(count = 1): void {
    invoicesGeneratedTotal.inc(count);
  }

  /** A refund reached a terminal outcome. */
  recordRefundProcessed(status: 'processed' | 'failed'): void {
    refundsProcessedTotal.labels(status).inc();
  }

  /** A seller payout run finished. */
  recordPayoutRun(status: 'success' | 'failed'): void {
    payoutRunsTotal.labels(status).inc();
  }
}
