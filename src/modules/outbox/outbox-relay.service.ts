import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, OutboxStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { OUTBOX_QUEUE } from './outbox.constants';

interface ClaimRow {
  id: string;
  type: string;
  queue: string;
}

/**
 * OutboxRelayService — moves committed OutboxEvent rows onto their BullMQ queue.
 *
 * Runs every 10s (with an in-process `running` guard, modelled on
 * PaymentReconciliationCron so two ticks never overlap in one instance). Each
 * tick:
 *   1. Reclaims stale PROCESSING rows (a crash between claim and enqueue, or a
 *      dead worker) back to PENDING — jobs are removed on completion, so
 *      re-adding under the same jobId is safe.
 *   2. Claims a batch of due PENDING rows with `FOR UPDATE SKIP LOCKED` and
 *      flips them to PROCESSING in one transaction — SKIP LOCKED lets multiple
 *      app instances share the poll without double-dispatching a row.
 *   3. Adds one BullMQ job per row (`jobId = outboxId` → the queue itself
 *      de-dupes a re-add while a job is still live). If the add fails (Redis
 *      blip) the row is flipped back to PENDING immediately — no attempt burned.
 *
 * The relay is intentionally a THIN pump: it never performs side effects. The
 * per-queue `WorkerHost` processors do, via `OutboxExecutionService`.
 */
@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger(OutboxRelayService.name);
  private running = false;

  private static readonly BATCH_SIZE = 50;

  private readonly queues: Record<string, Queue>;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(OUTBOX_QUEUE.INVOICES) invoices: Queue,
    @InjectQueue(OUTBOX_QUEUE.EMAILS) emails: Queue,
    @InjectQueue(OUTBOX_QUEUE.COURIER) courier: Queue,
    @InjectQueue(OUTBOX_QUEUE.CART) cart: Queue,
  ) {
    this.queues = {
      [OUTBOX_QUEUE.INVOICES]: invoices,
      [OUTBOX_QUEUE.EMAILS]: emails,
      [OUTBOX_QUEUE.COURIER]: courier,
      [OUTBOX_QUEUE.CART]: cart,
    };
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async relay(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.reclaimStale();
      await this.dispatchBatch();
    } catch (err) {
      this.logger.error(`Outbox relay run failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Reset PROCESSING rows stuck past the 5-minute stale window back to PENDING
   * (a crash between claim and enqueue, or a dead worker). Jobs are removed on
   * completion, so re-adding under the same jobId is safe.
   */
  private async reclaimStale(): Promise<void> {
    const reclaimed = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "OutboxEvent"
         SET "status" = 'PENDING'::"OutboxStatus", "updatedAt" = now()
       WHERE "status" = 'PROCESSING'::"OutboxStatus"
         AND "updatedAt" < now() - interval '5 minutes'
    `);
    if (reclaimed > 0) {
      this.logger.warn(
        `Reclaimed ${reclaimed} stale PROCESSING outbox row(s) back to PENDING.`,
      );
    }
  }

  private async dispatchBatch(): Promise<void> {
    // Claim + flip to PROCESSING atomically so a second poller (or instance)
    // skips these locked rows.
    const claimed = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimRow[]>(Prisma.sql`
        SELECT "id", "type", "queue"
          FROM "OutboxEvent"
         WHERE "status" = 'PENDING'::"OutboxStatus"
           AND "nextRunAt" <= now()
         ORDER BY "nextRunAt" ASC
         LIMIT ${OutboxRelayService.BATCH_SIZE}
         FOR UPDATE SKIP LOCKED
      `);
      if (rows.length === 0) return rows;
      const ids = rows.map((r) => r.id);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "OutboxEvent"
           SET "status" = 'PROCESSING'::"OutboxStatus", "updatedAt" = now()
         WHERE "id" IN (${Prisma.join(ids)})
      `);
      return rows;
    });

    for (const row of claimed) {
      const queue = this.queues[row.queue];
      if (!queue) {
        // Unknown queue name — park it FAILED so it isn't reclaimed forever.
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: {
            status: OutboxStatus.FAILED,
            lastError: `No queue registered for "${row.queue}"`,
          },
        });
        this.logger.error(
          `Outbox row ${row.id} references unknown queue "${row.queue}" — marked FAILED.`,
        );
        continue;
      }

      try {
        await queue.add(
          row.type,
          { outboxId: row.id },
          { jobId: row.id, removeOnComplete: true, removeOnFail: true },
        );
      } catch (err) {
        // Couldn't enqueue (Redis blip) — return the row to PENDING so the next
        // tick retries it. Don't count this as a delivery attempt.
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: { status: OutboxStatus.PENDING },
        });
        this.logger.warn(
          `Failed to enqueue outbox row ${row.id} to "${row.queue}": ${(err as Error).message}. Will retry.`,
        );
      }
    }
  }
}
