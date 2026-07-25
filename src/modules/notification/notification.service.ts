/**
 * NotificationService — writer + reader for the in-app notification bell (P3-08).
 *
 * WRITE (`create`) is the choke point the outbox worker handlers call ALONGSIDE
 * each lifecycle email. It is IDEMPOTENT via `dedupeKey`: writes go through
 * `createMany` + `skipDuplicates` (→ ON CONFLICT DO NOTHING on the unique index)
 * so a redelivered outbox job never produces a duplicate bell entry, and — like
 * OutboxService.enqueue — a duplicate key is skipped WITHOUT aborting an
 * enclosing transaction (a plain `create` would raise P2002 and roll the caller
 * back). Handlers call it BEFORE sending the email so a create failure retries
 * the whole (idempotent) handler before any mail goes out.
 *
 * READ methods back the shared GraphQL contract (myNotifications /
 * unreadNotificationCount / markNotificationRead / markAllNotificationsRead) and
 * are always scoped to the acting principal's `userId`.
 */

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationEntity } from './entities/notification.entity';

export interface CreateNotificationInput {
  /** Recipient user id (the principal whose bell this shows in). */
  userId: string;
  /** Notification kind, e.g. `order_placed`, `seller_new_order`. */
  type: string;
  /** Short headline. */
  title: string;
  /** One-line body. */
  body: string;
  /** Optional structured context (ids/amounts/links) — round-tripped to JSON. */
  data?: unknown;
  /**
   * Optional idempotency key. A second create with the same key is skipped (no
   * duplicate bell entry). Omit for ad-hoc notifications with no natural dedupe
   * identity.
   */
  dedupeKey?: string;
}

/**
 * Normalise arbitrary structured context into a Prisma JSON input. `undefined`/
 * `null` leave the column NULL (the field is omitted); everything else
 * round-trips through JSON so Decimals/Dates serialise and a non-serialisable
 * value can't fail the write.
 */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
}

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Insert one notification, idempotently on `dedupeKey`. Accepts an optional
   * transaction client so a caller can write the notification atomically with
   * its business state; defaults to the base client for the (common) worker
   * callsite that runs outside a transaction.
   */
  async create(
    input: CreateNotificationInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client: Prisma.TransactionClient = tx ?? this.prisma;
    await client.notification.createMany({
      data: [
        {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          data: toJson(input.data),
          dedupeKey: input.dedupeKey ?? null,
        },
      ],
      skipDuplicates: true,
    });
  }

  /** The principal's feed, newest first. */
  async listForUser(
    userId: string,
    limit = 20,
    offset = 0,
  ): Promise<NotificationEntity[]> {
    const take = Math.min(100, Math.max(1, limit));
    const skip = Math.max(0, offset);
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
    return rows.map((r) => this.toEntity(r));
  }

  /** Count of the principal's unread notifications. */
  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  /**
   * Mark one notification read, scoped to its owner. Idempotent: re-marking an
   * already-read notification is a no-op that still returns the row. Returns
   * null when the id does not belong to the principal (or does not exist) so the
   * resolver can surface a not-found without leaking another user's row.
   */
  async markRead(
    userId: string,
    id: string,
  ): Promise<NotificationEntity | null> {
    const existing = await this.prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!existing) return null;
    if (existing.readAt) return this.toEntity(existing);

    const updated = await this.prisma.notification.update({
      where: { id: existing.id },
      data: { readAt: new Date() },
    });
    return this.toEntity(updated);
  }

  /** Mark all of the principal's unread notifications read; returns the count. */
  async markAllRead(userId: string): Promise<number> {
    const res = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return res.count;
  }

  private toEntity(row: {
    id: string;
    type: string;
    title: string;
    body: string;
    data: Prisma.JsonValue | null;
    readAt: Date | null;
    createdAt: Date;
  }): NotificationEntity {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      data: row.data == null ? null : JSON.stringify(row.data),
      read: row.readAt != null,
      createdAt: row.createdAt,
    };
  }
}
