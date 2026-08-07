import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaService } from '@/prisma/prisma.service';
import { PushSubscriptionService } from './push-subscription.service';

/**
 * PushSubscriptionService (P4) — register upserts on the unique endpoint;
 * unregister + list are scoped to the acting user.
 */
describe('PushSubscriptionService', () => {
  let service: PushSubscriptionService;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    service = new PushSubscriptionService(prisma as unknown as PrismaService);
  });

  it('registers by upserting on the endpoint, bound to the user', async () => {
    const row = {
      id: 'ps-1',
      endpoint: 'https://push/abc',
      userAgent: 'Firefox',
      createdAt: new Date(),
    };
    prisma.pushSubscription.upsert.mockResolvedValue(row as never);

    const out = await service.register('u-1', {
      endpoint: 'https://push/abc',
      p256dh: 'key',
      auth: 'secret',
      userAgent: 'Firefox',
    });

    expect(out.id).toBe('ps-1');
    expect(out.endpoint).toBe('https://push/abc');
    const arg = (prisma.pushSubscription.upsert as jest.Mock).mock.calls[0][0];
    expect(arg.where).toEqual({ endpoint: 'https://push/abc' });
    expect(arg.create.userId).toBe('u-1');
    expect(arg.update.userId).toBe('u-1');
  });

  it('unregister is scoped to the user and reports whether a row was removed', async () => {
    prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 1 } as never);

    const ok = await service.unregister('u-1', 'https://push/abc');

    expect(ok).toBe(true);
    expect(
      (prisma.pushSubscription.deleteMany as jest.Mock).mock.calls[0][0],
    ).toEqual({ where: { userId: 'u-1', endpoint: 'https://push/abc' } });
  });

  it('unregister returns false when nothing matched', async () => {
    prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 0 } as never);
    expect(await service.unregister('u-1', 'nope')).toBe(false);
  });

  it('lists the caller subscriptions newest-first', async () => {
    prisma.pushSubscription.findMany.mockResolvedValue([
      { id: 'ps-1', endpoint: 'e1', userAgent: null, createdAt: new Date() },
    ] as never);

    const out = await service.listForUser('u-1');

    expect(out).toHaveLength(1);
    const arg = (prisma.pushSubscription.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where).toEqual({ userId: 'u-1' });
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
  });
});
