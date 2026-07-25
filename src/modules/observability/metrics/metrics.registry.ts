/**
 * P3-04 — Central definitions for every application metric.
 *
 * Every metric is a prom-client singleton registered on the DEFAULT global
 * registry (`prom-client`'s `register`). We use plain singletons rather than
 * `@willsoto/nestjs-prometheus` `makeXProvider` DI providers because two of the
 * hottest producers live OUTSIDE comfortable Nest DI reach:
 *   • the Prisma query-timing extension (composed inside PrismaService, which is
 *     constructed at DI time and cannot itself `@InjectMetric`), and
 *   • the global HTTP interceptor (registered as APP_INTERCEPTOR in AppModule,
 *     a different module from where the metric providers live).
 * A shared singleton on the default registry sidesteps cross-module export
 * gymnastics while still being serialized by the `@willsoto` `/metrics`
 * controller (which reads that same default registry). `MetricsService`,
 * `HttpMetricsInterceptor`, `OutboxMetricsCollector`, and the Prisma extension
 * all reference the identical instances defined here.
 *
 * Creation is idempotent (`register.getSingleMetric(name) ?? new …`) so a
 * dev/watch-mode module reload never throws "metric already registered".
 */

import { Counter, Gauge, Histogram, register } from 'prom-client';

/** Idempotent Histogram factory (safe across hot reloads). */
function histogram(config: {
  name: string;
  help: string;
  labelNames?: string[];
  buckets?: number[];
}): Histogram<string> {
  return (
    (register.getSingleMetric(config.name) as Histogram<string>) ??
    new Histogram(config)
  );
}

/** Idempotent Counter factory. */
function counter(config: {
  name: string;
  help: string;
  labelNames?: string[];
}): Counter<string> {
  return (
    (register.getSingleMetric(config.name) as Counter<string>) ??
    new Counter(config)
  );
}

/** Idempotent Gauge factory. */
function gauge(config: {
  name: string;
  help: string;
  labelNames?: string[];
}): Gauge<string> {
  return (
    (register.getSingleMetric(config.name) as Gauge<string>) ?? new Gauge(config)
  );
}

// ─── HTTP + DB latency ───────────────────────────────────────────────────────

/** Request duration by method/route/status. Observed once per HTTP request. */
export const httpRequestDuration = histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds, labelled by method, route and status.',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

/** Prisma per-operation query duration by model/operation. */
export const prismaQueryDuration = histogram({
  name: 'prisma_query_duration_seconds',
  help: 'Prisma client query duration in seconds, labelled by model and operation.',
  labelNames: ['model', 'operation'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

// ─── Business counters (incremented via MetricsService) ──────────────────────

/** Payment outcomes. `result` = success|failure, `method` = prepaid|cod. */
export const paymentTransactionsTotal = counter({
  name: 'payment_transactions_total',
  help: 'Count of payment finalisation outcomes by result and payment method.',
  labelNames: ['result', 'method'],
});

/** Gateway webhooks received (all, pre-processing). `provider` = razorpay|… */
export const webhookReceivedTotal = counter({
  name: 'webhook_received_total',
  help: 'Count of inbound gateway/courier webhooks received, by provider.',
  labelNames: ['provider'],
});

/** Webhooks that failed signature verification or processing. */
export const webhookFailedTotal = counter({
  name: 'webhook_failed_total',
  help: 'Count of inbound webhooks that failed verification or processing, by provider.',
  labelNames: ['provider'],
});

/** Tax invoices successfully generated. */
export const invoicesGeneratedTotal = counter({
  name: 'invoices_generated_total',
  help: 'Count of tax invoices successfully generated.',
});

/** Refund outcomes. `status` = processed|failed. */
export const refundsProcessedTotal = counter({
  name: 'refunds_processed_total',
  help: 'Count of refunds processed by outcome status.',
  labelNames: ['status'],
});

/** Seller payout run outcomes. `status` = success|failed. */
export const payoutRunsTotal = counter({
  name: 'payout_runs_total',
  help: 'Count of seller payout runs by outcome status.',
  labelNames: ['status'],
});

// ─── Queue-depth gauges (set by OutboxMetricsCollector) ──────────────────────

/**
 * Durable-outbox backlog by status + queue. Source of truth is the OutboxEvent
 * table (the BullMQ queues mirror it), so we read Postgres directly — see
 * OutboxMetricsCollector. `status` ∈ PENDING|PROCESSING|FAILED.
 */
export const outboxEventsGauge = gauge({
  name: 'outbox_events',
  help: 'Number of durable-outbox events grouped by status and queue.',
  labelNames: ['status', 'queue'],
});
