import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getCorrelationId } from '@/common/context/request-context';
import type { OutboxQueue } from './outbox.constants';

export interface EnqueueOutboxInput {
  /** Dot-namespaced handler key (see OUTBOX_EVENT), e.g. `invoice.generate`. */
  type: string;
  /** The BullMQ queue this event is dispatched to. */
  queue: OutboxQueue;
  /** Minimal reference data (usually ids) the worker re-reads state from. */
  payload: Prisma.InputJsonValue;
  /**
   * Optional idempotency key. A second enqueue with the same key is skipped
   * (no duplicate side effect). Omit for events that are naturally one-shot.
   */
  dedupeKey?: string;
}

/**
 * OutboxService — the ONLY way to schedule a durable side effect.
 *
 * `enqueue` DELIBERATELY requires a Prisma transaction client: the OutboxEvent
 * row must be written in the SAME `$transaction` as the business state that
 * caused it, so "we changed state" and "we owe a side effect" commit or roll
 * back together. Passing `this.prisma` here (outside a tx) would reintroduce
 * exactly the dropped-side-effect bug this system exists to kill — so the type
 * forces a `Prisma.TransactionClient`.
 *
 * Enqueue is idempotent via `dedupeKey`: we use `createMany` + `skipDuplicates`
 * (→ `ON CONFLICT DO NOTHING`) so a duplicate key is skipped WITHOUT aborting
 * the caller's transaction — a plain `create` would raise P2002 and roll the
 * whole business write back.
 */
@Injectable()
export class OutboxService {
  async enqueue(
    tx: Prisma.TransactionClient,
    input: EnqueueOutboxInput,
  ): Promise<void> {
    const correlationId = getCorrelationId() ?? null;
    await tx.outboxEvent.createMany({
      data: [
        {
          type: input.type,
          queue: input.queue,
          payload: input.payload,
          dedupeKey: input.dedupeKey ?? null,
          correlationId,
        },
      ],
      skipDuplicates: true,
    });
  }
}
