import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaService } from '@/prisma/prisma.service';
import { PrivacyService } from '@/modules/compliance/privacy/privacy.service';
import {
  NotificationDispatchService,
  inQuietHours,
} from './notification-dispatch.service';
import { SmsChannel } from './sms.channel';
import { WebPushChannel } from './web-push.channel';
import type { CreateNotificationInput } from '../notification.service';

/**
 * NotificationDispatchService — the SMS + Web-Push fan-out (P4 notification
 * depth). Verifies the consent/quiet-hours gating, the "no config ⇒ no DB work"
 * short-circuit, per-subscription push, and dead-subscription pruning.
 */
describe('NotificationDispatchService', () => {
  let service: NotificationDispatchService;
  let prisma: DeepMockProxy<PrismaService>;
  let sms: DeepMockProxy<SmsChannel>;
  let webPush: DeepMockProxy<WebPushChannel>;
  let privacy: DeepMockProxy<PrivacyService>;

  // A weekday noon UTC = 17:30 IST — safely OUTSIDE the 21:00–09:00 quiet window.
  const NOON_UTC = new Date(Date.UTC(2026, 6, 30, 12, 0, 0));

  const txnInput: CreateNotificationInput = {
    userId: 'user-1',
    type: 'order_placed',
    title: 'Order placed',
    body: 'Your order #123 has been placed.',
    data: { orderId: 'o-1', link: '/account/orders/o-1' },
  };
  const marketingInput: CreateNotificationInput = {
    userId: 'user-1',
    type: 'back_in_stock',
    title: 'Back in stock',
    body: 'Widget is back in stock.',
    data: { link: '/products/widget' },
  };

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    sms = mockDeep<SmsChannel>();
    webPush = mockDeep<WebPushChannel>();
    privacy = mockDeep<PrivacyService>();
    service = new NotificationDispatchService(
      prisma as unknown as PrismaService,
      sms as unknown as SmsChannel,
      webPush as unknown as WebPushChannel,
      privacy as unknown as PrivacyService,
    );
    sms.send.mockResolvedValue({ sent: true });
    webPush.send.mockResolvedValue({ sent: true });
  });

  it('does ZERO DB work when neither channel is configured', async () => {
    sms.isConfigured.mockReturnValue(false);
    webPush.isConfigured.mockReturnValue(false);

    await service.fanOut(txnInput, NOON_UTC);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(sms.send).not.toHaveBeenCalled();
    expect(webPush.send).not.toHaveBeenCalled();
  });

  it('sends a transactional SMS when the user has a phone', async () => {
    sms.isConfigured.mockReturnValue(true);
    webPush.isConfigured.mockReturnValue(false);
    prisma.user.findUnique.mockResolvedValue({
      phone: '+919812345678',
      Customer: { marketingOptIn: false },
    } as never);

    await service.fanOut(txnInput, NOON_UTC);

    expect(sms.send).toHaveBeenCalledTimes(1);
    expect(sms.send.mock.calls[0][0]).toBe('+919812345678');
    expect(sms.send.mock.calls[0][1].type).toBe('order_placed');
  });

  it('suppresses a MARKETING-class SMS without marketing consent (authoritative canMarket)', async () => {
    sms.isConfigured.mockReturnValue(true);
    webPush.isConfigured.mockReturnValue(false);
    prisma.user.findUnique.mockResolvedValue({
      phone: '+919812345678',
    } as never);
    privacy.canMarket.mockResolvedValue(false); // ledger says no marketing

    await service.fanOut(marketingInput, NOON_UTC);

    expect(sms.send).not.toHaveBeenCalled();
  });

  it('sends a MARKETING-class SMS with consent, outside quiet hours', async () => {
    sms.isConfigured.mockReturnValue(true);
    webPush.isConfigured.mockReturnValue(false);
    prisma.user.findUnique.mockResolvedValue({
      phone: '+919812345678',
    } as never);
    privacy.canMarket.mockResolvedValue(true); // ledger grants marketing

    await service.fanOut(marketingInput, NOON_UTC);

    expect(sms.send).toHaveBeenCalledTimes(1);
    expect(privacy.canMarket).toHaveBeenCalledWith('user-1');
  });

  it('never sends SMS when the user has no phone', async () => {
    sms.isConfigured.mockReturnValue(true);
    webPush.isConfigured.mockReturnValue(false);
    prisma.user.findUnique.mockResolvedValue({
      phone: null,
      Customer: { marketingOptIn: true },
    } as never);

    await service.fanOut(txnInput, NOON_UTC);

    expect(sms.send).not.toHaveBeenCalled();
  });

  it('pushes to every live subscription and prunes the gone ones', async () => {
    sms.isConfigured.mockReturnValue(false);
    webPush.isConfigured.mockReturnValue(true);
    prisma.user.findUnique.mockResolvedValue({
      phone: null,
      Customer: { marketingOptIn: false },
    } as never);
    prisma.pushSubscription.findMany.mockResolvedValue([
      { id: 'sub-1', endpoint: 'https://push/1', p256dh: 'k1', auth: 'a1' },
      { id: 'sub-2', endpoint: 'https://push/2', p256dh: 'k2', auth: 'a2' },
    ] as never);
    webPush.send
      .mockResolvedValueOnce({ sent: true })
      .mockResolvedValueOnce({ sent: false, expired: true });

    await service.fanOut(txnInput, NOON_UTC);

    expect(webPush.send).toHaveBeenCalledTimes(2);
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledTimes(1);
    const deleteArg = (prisma.pushSubscription.deleteMany as jest.Mock).mock
      .calls[0][0];
    expect(deleteArg).toEqual({ where: { id: { in: ['sub-2'] } } });
  });

  it('never throws when a channel blows up', async () => {
    sms.isConfigured.mockReturnValue(true);
    webPush.isConfigured.mockReturnValue(false);
    prisma.user.findUnique.mockRejectedValue(new Error('db down'));

    await expect(service.fanOut(txnInput, NOON_UTC)).resolves.toBeUndefined();
  });

  describe('inQuietHours (IST 21:00–09:00)', () => {
    it('is true just after 21:00 IST (15:35 UTC)', () => {
      expect(inQuietHours(new Date(Date.UTC(2026, 6, 30, 15, 35)))).toBe(true);
    });
    it('is false at 17:30 IST (12:00 UTC)', () => {
      expect(inQuietHours(new Date(Date.UTC(2026, 6, 30, 12, 0)))).toBe(false);
    });
    it('is true at 03:00 IST (21:30 UTC prev day)', () => {
      expect(inQuietHours(new Date(Date.UTC(2026, 6, 29, 21, 30)))).toBe(true);
    });
  });
});
