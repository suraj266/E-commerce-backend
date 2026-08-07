import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaService } from '@/prisma/prisma.service';
import { OutboxService } from '@/modules/outbox/outbox.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { PrivacyService } from '@/modules/compliance/privacy/privacy.service';
import { OUTBOX_QUEUE } from '@/modules/outbox/outbox.constants';
import { BackInStockService } from './back-in-stock.service';
import { NotificationService } from './notification.service';
import { NOTIFICATION_OUTBOX_EVENT, NOTIFICATION_TYPE } from './notification.constants';

/**
 * BackInStockService (P4) — sweep transition logic (alert / dedupe / re-arm) and
 * the durable outbox handler. Per guard rule 7 the tx-passed enqueue arg is
 * asserted by IDENTITY against the tx stub, never expect.anything().
 */
describe('BackInStockService', () => {
  let service: BackInStockService;
  let prisma: DeepMockProxy<PrismaService>;
  let outbox: DeepMockProxy<OutboxService>;
  let notifications: DeepMockProxy<NotificationService>;
  let email: DeepMockProxy<EmailService>;
  let privacy: DeepMockProxy<PrivacyService>;

  const wishlistItem = {
    id: 'wi-1',
    productId: 'p-1',
    variantId: 'v-1',
    wishlist: { customerId: 'c-1', customer: { userId: 'u-1' } },
  };

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    outbox = mockDeep<OutboxService>();
    notifications = mockDeep<NotificationService>();
    email = mockDeep<EmailService>();
    privacy = mockDeep<PrivacyService>();
    service = new BackInStockService(
      prisma as unknown as PrismaService,
      outbox as unknown as OutboxService,
      notifications as unknown as NotificationService,
      email as unknown as EmailService,
      privacy as unknown as PrivacyService,
    );
    // back_in_stock is marketing-class — default to consent granted; the
    // suppression case overrides to false.
    privacy.canMarket.mockResolvedValue(true);
  });

  /** Stub the availability reads: variant v-1 is active with `available` on hand. */
  function stubAvailability(available: number) {
    prisma.wishlistItem.findMany.mockResolvedValue([wishlistItem] as never);
    prisma.productVariant.findMany.mockResolvedValue([{ id: 'v-1' }] as never);
    prisma.inventory.groupBy.mockResolvedValue([
      { variantId: 'v-1', _sum: { quantityAvailable: available } },
    ] as never);
  }

  describe('runSweep', () => {
    it('alerts a restocked item with no prior ledger row (insert + enqueue)', async () => {
      stubAvailability(5);
      prisma.backInStockAlert.findMany.mockResolvedValue([] as never);

      const tx = { backInStockAlert: { createMany: jest.fn().mockResolvedValue({ count: 1 }) } };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$transaction as unknown as jest.Mock).mockImplementation((cb: any) => cb(tx));

      const res = await service.runSweep();

      expect(res).toEqual({ alerted: 1, rearmed: 0 });
      expect(tx.backInStockAlert.createMany).toHaveBeenCalledTimes(1);
      expect(outbox.enqueue).toHaveBeenCalledTimes(1);
      // tx identity (guard rule 7) + the durable event shape.
      expect(outbox.enqueue.mock.calls[0][0]).toBe(tx);
      const evt = outbox.enqueue.mock.calls[0][1];
      expect(evt.type).toBe(NOTIFICATION_OUTBOX_EVENT.BACK_IN_STOCK);
      expect(evt.queue).toBe(OUTBOX_QUEUE.EMAILS);
      expect(evt.dedupeKey).toMatch(/^bis:/);
    });

    it('does nothing for an in-stock item that was already alerted', async () => {
      stubAvailability(5);
      prisma.backInStockAlert.findMany.mockResolvedValue([
        { wishlistItemId: 'wi-1' },
      ] as never);

      const res = await service.runSweep();

      expect(res).toEqual({ alerted: 0, rearmed: 0 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.backInStockAlert.deleteMany).not.toHaveBeenCalled();
    });

    it('re-arms an item that went out of stock (deletes its ledger row)', async () => {
      stubAvailability(0); // sold out again
      prisma.backInStockAlert.findMany.mockResolvedValue([
        { wishlistItemId: 'wi-1' },
      ] as never);
      prisma.backInStockAlert.deleteMany.mockResolvedValue({ count: 1 } as never);

      const res = await service.runSweep();

      expect(res).toEqual({ alerted: 0, rearmed: 1 });
      expect(prisma.backInStockAlert.deleteMany).toHaveBeenCalledTimes(1);
      expect(
        (prisma.backInStockAlert.deleteMany as jest.Mock).mock.calls[0][0],
      ).toEqual({ where: { wishlistItemId: { in: ['wi-1'] } } });
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('no-ops on an empty wishlist', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([] as never);
      const res = await service.runSweep();
      expect(res).toEqual({ alerted: 0, rearmed: 0 });
    });
  });

  describe('sendBackInStockAlert', () => {
    const payload = {
      alertId: 'al-1',
      wishlistItemId: 'wi-1',
      variantId: 'v-1',
      productId: 'p-1',
      customerId: 'c-1',
      userId: 'u-1',
    };

    it('writes the bell (with per-alert dedupeKey) + sends the email', async () => {
      prisma.wishlistItem.findUnique.mockResolvedValue({ id: 'wi-1' } as never);
      prisma.product.findUnique.mockResolvedValue({
        id: 'p-1',
        name: 'Widget',
        slug: 'widget',
        status: 'ACTIVE',
        deletedAt: null,
      } as never);
      prisma.inventory.aggregate.mockResolvedValue({
        _sum: { quantityAvailable: 3 },
      } as never);
      prisma.user.findUnique.mockResolvedValue({
        email: 'a@b.com',
        name: 'Ann',
      } as never);
      email.send.mockResolvedValue({ sent: true } as never);

      await service.sendBackInStockAlert(payload);

      expect(notifications.create).toHaveBeenCalledTimes(1);
      const bell = notifications.create.mock.calls[0][0];
      expect(bell.type).toBe(NOTIFICATION_TYPE.BACK_IN_STOCK);
      expect(bell.dedupeKey).toBe('notif:back_in_stock:al-1');
      expect(bell.userId).toBe('u-1');
      expect(email.send).toHaveBeenCalledTimes(1);
      expect(email.send.mock.calls[0][0]).toBe('back_in_stock');
    });

    it('does NOT send the (marketing) email when consent is withdrawn (review #6)', async () => {
      prisma.wishlistItem.findUnique.mockResolvedValue({ id: 'wi-1' } as never);
      prisma.product.findUnique.mockResolvedValue({
        id: 'p-1',
        name: 'Widget',
        slug: 'widget',
        status: 'ACTIVE',
        deletedAt: null,
      } as never);
      prisma.inventory.aggregate.mockResolvedValue({
        _sum: { quantityAvailable: 3 },
      } as never);
      prisma.user.findUnique.mockResolvedValue({
        email: 'a@b.com',
        name: 'Ann',
      } as never);
      privacy.canMarket.mockResolvedValue(false); // consent withdrawn

      await service.sendBackInStockAlert(payload);

      // The in-app bell still writes (it's the user's own wishlist), but the
      // marketing EMAIL must be suppressed — same gate as the SMS channel.
      expect(email.send).not.toHaveBeenCalled();
    });

    it('no-ops when the wishlist item was removed', async () => {
      prisma.wishlistItem.findUnique.mockResolvedValue(null as never);

      await service.sendBackInStockAlert(payload);

      expect(notifications.create).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('no-ops (no bell) when it sold out again before the handler ran', async () => {
      prisma.wishlistItem.findUnique.mockResolvedValue({ id: 'wi-1' } as never);
      prisma.product.findUnique.mockResolvedValue({
        id: 'p-1',
        name: 'Widget',
        slug: 'widget',
        status: 'ACTIVE',
        deletedAt: null,
      } as never);
      prisma.inventory.aggregate.mockResolvedValue({
        _sum: { quantityAvailable: 0 },
      } as never);

      await service.sendBackInStockAlert(payload);

      expect(notifications.create).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });
  });
});
