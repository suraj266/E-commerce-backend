/**
 * P3-04 — OutboxMetricsCollector: keeps the `outbox_events{status,queue}` gauge
 * fresh from the durable-outbox table.
 *
 * The OutboxEvent table is the source of truth for the reliability backlog (the
 * BullMQ queues mirror it), so we read Postgres directly with a cheap `groupBy`
 * rather than probing Bull. Runs on a timer (not at scrape time) so a scrape
 * never blocks on the DB, and follows the repo's cron convention: a private
 * in-process `running` guard (mirrors PaymentReconciliationCron) so overlapping
 * ticks can't stack.
 *
 * We only surface the actionable statuses — PENDING (backlog), PROCESSING
 * (in-flight), FAILED (parked) — and `reset()` each pass so a (status,queue)
 * pair that drops to zero stops reporting a stale value.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/prisma/prisma.service';
import { outboxEventsGauge } from './metrics.registry';

/** Backlog-relevant statuses. DONE is excluded (it only ever grows). */
const TRACKED_STATUSES = ['PENDING', 'PROCESSING', 'FAILED'] as const;

@Injectable()
export class OutboxMetricsCollector {
  private readonly logger = new Logger(OutboxMetricsCollector.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async collect(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.prisma.outboxEvent.groupBy({
        by: ['status', 'queue'],
        where: { status: { in: [...TRACKED_STATUSES] } },
        _count: { _all: true },
      });

      // Reset first so pairs that fell to zero since the last pass disappear
      // instead of reporting a stale count.
      outboxEventsGauge.reset();
      for (const row of rows) {
        outboxEventsGauge
          .labels(String(row.status), String(row.queue))
          .set(row._count._all);
      }
    } catch (err) {
      // Best-effort: a metrics-collection miss must never crash the scheduler.
      this.logger.warn(
        `Outbox gauge refresh failed: ${(err as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }
}
