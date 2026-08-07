/**
 * PushSubscriptionService — CRUD for browser Web-Push registrations (Phase 4).
 *
 * `register` UPSERTs on the globally-unique `endpoint`, so re-subscribing the
 * same browser refreshes its keys and (re)binds it to the current user rather
 * than accumulating stale rows. `unregister`/`listForUser` are scoped to the
 * acting principal so a user only ever touches their own devices.
 *
 * The fan-out (NotificationDispatchService) reads subscriptions directly; this
 * service owns the write surface behind the register/unregister mutations.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { PushSubscriptionEntity } from './entities/push-subscription.entity';
import { RegisterPushSubscriptionInput } from './dto/register-push-subscription.input';

@Injectable()
export class PushSubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Register (or refresh) a browser push subscription for `userId`. */
  async register(
    userId: string,
    input: RegisterPushSubscriptionInput,
  ): Promise<PushSubscriptionEntity> {
    const row = await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      update: {
        userId,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
      },
      create: {
        userId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
      },
    });
    return toEntity(row);
  }

  /**
   * Remove one of the caller's subscriptions by endpoint. Scoped to `userId`
   * so a caller can't unregister another user's device. Idempotent: returns
   * false if nothing matched.
   */
  async unregister(userId: string, endpoint: string): Promise<boolean> {
    const res = await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });
    return res.count > 0;
  }

  /** The caller's registered devices, newest first. */
  async listForUser(userId: string): Promise<PushSubscriptionEntity[]> {
    const rows = await this.prisma.pushSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toEntity);
  }
}

function toEntity(row: {
  id: string;
  endpoint: string;
  userAgent: string | null;
  createdAt: Date;
}): PushSubscriptionEntity {
  return {
    id: row.id,
    endpoint: row.endpoint,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
  };
}
