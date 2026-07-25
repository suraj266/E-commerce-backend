import { Injectable, Logger } from '@nestjs/common';
import { OutboxStatus } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '@/prisma/prisma.service';
import { runWithCorrelationId } from '@/common/context/request-context';
import { backoffDelayMs } from '@/common/http/with-resilience';

/** The event shape handlers receive (payload is decoded JSON). */
export interface OutboxEventView {
  id: string;
  type: string;
  queue: string;
  attempts: number;
  maxAttempts: number;
  correlationId: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
}

export type OutboxHandler = (event: OutboxEventView) => Promise<void>;

/**
 * The shared per-job envelope every queue processor runs through, so DONE /
 * retry-with-backoff / FAILED-and-Sentry semantics live in exactly one place.
 *
 * Flow for one claimed OutboxEvent (identified by `outboxId` in the BullMQ job):
 *   1. Load the row. Missing → nothing to do. Already DONE → idempotent skip
 *      (a duplicate delivery, e.g. after a stale-PROCESSING reclaim).
 *   2. Run the domain handler INSIDE `runWithCorrelationId` so the side
 *      effect's logs + Sentry events rejoin the originating request trace.
 *   3. Success → mark DONE (processedAt set, lastError cleared).
 *      Failure → increment attempts; if under `maxAttempts`, requeue by
 *      flipping back to PENDING with a jittered exponential `nextRunAt` (the
 *      relay re-dispatches when due); else park FAILED + report to Sentry.
 *
 * The processor NEVER rethrows: retries are DB-driven (nextRunAt), so the
 * BullMQ job always completes and is removed, freeing its jobId for the relay
 * to re-add on the next due tick.
 */
@Injectable()
export class OutboxExecutionService {
  private readonly logger = new Logger(OutboxExecutionService.name);

  // Backoff schedule: 1s, 2s, 4s … capped at 5 min. With maxAttempts=8 the last
  // retries land minutes apart, giving a flapping dependency time to recover.
  private static readonly BASE_DELAY_MS = 1000;
  private static readonly MAX_DELAY_MS = 5 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async process(outboxId: string, handler: OutboxHandler): Promise<void> {
    const event = await this.prisma.outboxEvent.findUnique({
      where: { id: outboxId },
    });
    if (!event) return;
    if (event.status === OutboxStatus.DONE) return; // idempotent replay

    const view: OutboxEventView = {
      id: event.id,
      type: event.type,
      queue: event.queue,
      attempts: event.attempts,
      maxAttempts: event.maxAttempts,
      correlationId: event.correlationId,
      payload: event.payload,
    };

    await runWithCorrelationId(
      event.correlationId ?? event.id,
      async () => {
        try {
          await handler(view);
          await this.prisma.outboxEvent.update({
            where: { id: outboxId },
            data: {
              status: OutboxStatus.DONE,
              processedAt: new Date(),
              lastError: null,
            },
          });
        } catch (err) {
          await this.onFailure(view, err);
        }
      },
    );
  }

  private async onFailure(
    event: OutboxEventView,
    err: unknown,
  ): Promise<void> {
    const attempts = event.attempts + 1;
    const message = (err as Error)?.message ?? String(err);

    if (attempts >= event.maxAttempts) {
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: OutboxStatus.FAILED,
          attempts,
          lastError: message.slice(0, 1000),
        },
      });
      this.logger.error(
        `Outbox event ${event.id} (${event.type}) FAILED after ${attempts} attempts: ${message}`,
      );
      Sentry.captureException(err, (scope) => {
        scope.setTag('outbox.event_type', event.type);
        scope.setTag('outbox.queue', event.queue);
        scope.setContext('outbox', {
          id: event.id,
          type: event.type,
          attempts,
        });
        return scope;
      });
      return;
    }

    const delay = backoffDelayMs(event.attempts, {
      baseDelayMs: OutboxExecutionService.BASE_DELAY_MS,
      maxDelayMs: OutboxExecutionService.MAX_DELAY_MS,
    });
    await this.prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: OutboxStatus.PENDING,
        attempts,
        nextRunAt: new Date(Date.now() + delay),
        lastError: message.slice(0, 1000),
      },
    });
    this.logger.warn(
      `Outbox event ${event.id} (${event.type}) failed (attempt ${attempts}/${event.maxAttempts}), ` +
        `retrying in ~${Math.round(delay / 1000)}s: ${message}`,
    );
  }
}
